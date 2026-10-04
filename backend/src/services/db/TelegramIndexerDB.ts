import Database from 'better-sqlite3';

export interface Chat {
	id: string;
	title: string;
	type: string;
	indexing_enabled: number;
}

export interface IndexingProgress {
	chat_id: string;
	last_message_id: number;
	/** Epoch ms of the end of the last indexing pass over the chat (null if never visited). */
	last_checked_at: number | null;
	/** Epoch ms of the last pass that stored new messages (null if none did). */
	last_indexed_at: number | null;
	/** Message of the error that ended the last pass; null when it went fine. */
	last_error: string | null;
}

/** A chat plus what the index holds for it, see getChatsOverview. Every `_at` is epoch ms. */
export interface ChatOverview extends Chat {
	/** Indexed messages (text or media). */
	message_count: number;
	/** Indexed messages carrying media. */
	media_count: number;
	/** Sum of the indexed file sizes, in bytes. */
	media_size: number;
	/** Forum topics known for the chat (0 for non-forum chats). */
	topic_count: number;
	last_message_id: number;
	/** Date of the newest indexed message (null while nothing is indexed). */
	last_message_at: number | null;
	last_checked_at: number | null;
	last_indexed_at: number | null;
	last_error: string | null;
}

export interface MessageInput {
	chatId: string;
	topicId: number;
	messageId: number;
	senderId: string;
	date: number;
	text: string;
	hasMedia: boolean;
	mediaType?: string;
	fileName?: string;
	fileSize?: number;
}

export interface MessageRow {
	id: number;
	chat_id: string;
	chat_title: string | null;
	topic_id: number;
	topic_name: string | null;
	message_id: number;
	sender_id: string;
	date: number;
	text: string;
	has_media: number;
	media_type: string | null;
	file_name: string | null;
	file_size: number | null;
	/** Epoch ms of the last time Telegram confirmed the media still exists (null if never checked). Only populated by searchFiles. */
	media_verified_at?: number | null;
}

/** Identifies one indexed message. */
export type MessageRef = Pick<MessageRow, 'chat_id' | 'message_id'>;

/**
 * The Telegram account this instance signs in with. One row (see the `account` table); every field but
 * `searchEnabled` is null until the first sign-in stores it.
 */
export interface TelegramAccount {
	apiId: number | null;
	apiHash: string | null;
	/** Serialized client session; null while signed out. */
	session: string | null;
	/** Whether searches reach the Telegram index. Independent of being signed in. */
	searchEnabled: boolean;
}

interface AccountRow {
	api_id: number | null;
	api_hash: string | null;
	session: string | null;
	search_enabled: number;
}

const DEFAULT_ACCOUNT: TelegramAccount = { apiId: null, apiHash: null, session: null, searchEnabled: true };

export interface ActiveDownloadRow {
	hash: string;
	chat_id: string;
	message_id: number;
	file_name: string;
	out_path: string;
	downloaded_bytes: number;
	file_size: number;
	status: string;
	error_message?: string | null;
}

// Quote each term so FTS5-special chars (' - : & ( ) ") match literally
// instead of throwing; keep uppercase OR/AND/NOT as operators. Drops
// punctuation-only terms; null when nothing usable remains.
export function toFtsMatchExpr(query: string): string | null {
	const expr = query
		.split(/\s+/)
		.map((tok) => {
			if (tok === 'OR' || tok === 'AND' || tok === 'NOT') return tok;
			if (!/[\p{L}\p{N}]/u.test(tok)) return '';
			return `"${tok.replace(/"/g, '""')}"`;
		})
		.filter((tok) => tok.length > 0)
		.join(' ');
	return expr.length > 0 ? expr : null;
}

export class TelegramIndexerDB {
	private db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma('journal_mode = WAL');
		this.initialize();
	}

	private initialize() {
		// Source of truth for chat titles
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chats (
				id TEXT PRIMARY KEY,
				title TEXT,
				type TEXT,
				indexing_enabled INTEGER DEFAULT 0
			);
		`);

		// Source of truth for topic names (normalized)
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS topics (
				chat_id TEXT NOT NULL,
				topic_id INTEGER NOT NULL,
				topic_name TEXT,
				PRIMARY KEY (chat_id, topic_id)
			);
		`);

		// Table to track indexing progress
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS indexing_progress (
				chat_id TEXT NOT NULL,
				last_message_id INTEGER DEFAULT 0,
				PRIMARY KEY (chat_id)
			);
		`);

		// Raw message content — no denormalized name columns
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS messages_content (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				chat_id TEXT NOT NULL,
				topic_id INTEGER DEFAULT 0,
				message_id INTEGER NOT NULL,
				sender_id TEXT,
				date INTEGER,
				text TEXT,
				has_media INTEGER DEFAULT 0,
				media_type TEXT,
				file_name TEXT,
				file_size INTEGER,
				UNIQUE(chat_id, topic_id, message_id)
			);
		`);

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS active_downloads (
				hash TEXT PRIMARY KEY,
				chat_id TEXT NOT NULL,
				message_id INTEGER NOT NULL,
				file_name TEXT,
				out_path TEXT,
				downloaded_bytes INTEGER DEFAULT 0,
				file_size INTEGER,
				status TEXT,
				error_message TEXT
			);
		`);

		// Migrations: columns added after the tables shipped (each fails harmlessly once it exists)
		const migrations = [
			'ALTER TABLE active_downloads ADD COLUMN error_message TEXT',
			'ALTER TABLE indexing_progress ADD COLUMN last_checked_at INTEGER',
			'ALTER TABLE indexing_progress ADD COLUMN last_indexed_at INTEGER',
			'ALTER TABLE indexing_progress ADD COLUMN last_error TEXT',
		];
		for (const sql of migrations) {
			try {
				this.db.exec(sql);
			} catch {
				// Column already exists — ignore
			}
		}

		// The account this instance signs in with: a single row, see TelegramAccount
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS account (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				api_id INTEGER,
				api_hash TEXT,
				session TEXT,
				search_enabled INTEGER NOT NULL DEFAULT 1
			);
		`);

		// Operational per-message metadata that plays no part in search. Kept apart from
		// messages_content so writing it never fires the FTS update trigger; add here any
		// future field that should not touch the index. All columns nullable: a row may
		// carry some fields and not others.
		//   media_verified_at — epoch ms of the last time Telegram confirmed the media still exists
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS messages_metadata (
				chat_id TEXT NOT NULL,
				message_id INTEGER NOT NULL,
				media_verified_at INTEGER,
				PRIMARY KEY (chat_id, message_id)
			);
		`);

		// View that joins messages with their normalized names — used as FTS5 content source
		this.db.exec(`
			CREATE VIEW IF NOT EXISTS messages_view AS
			SELECT
				mc.id,
				mc.chat_id,
				c.title        AS chat_title,
				mc.topic_id,
				t.topic_name,
				mc.message_id,
				mc.sender_id,
				mc.date,
				mc.text,
				mc.has_media,
				mc.media_type,
				mc.file_name,
				mc.file_size
			FROM messages_content mc
			LEFT JOIN chats c  ON c.id = mc.chat_id
			LEFT JOIN topics t ON t.chat_id = mc.chat_id AND t.topic_id = mc.topic_id;
		`);

		// FTS5 — content source is the view so rebuild reads resolved names automatically
		// Searchable columns: text, file_name, chat_title, topic_name
		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
				chat_id    UNINDEXED,
				chat_title,
				topic_id   UNINDEXED,
				topic_name,
				message_id UNINDEXED,
				sender_id  UNINDEXED,
				date       UNINDEXED,
				text,
				file_name,
				content='messages_view',
				content_rowid='id',
				tokenize='unicode61 remove_diacritics 2'
			);
		`);

		// Triggers — resolve names via subquery so they stay current with chats/topics tables
		this.db.exec(`
			CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages_content BEGIN
				INSERT INTO messages_fts(rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					new.id,
					new.chat_id,
					(SELECT title FROM chats WHERE id = new.chat_id),
					new.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = new.chat_id AND topic_id = new.topic_id),
					new.message_id, new.sender_id, new.date, new.text, new.file_name
				);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages_content BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					'delete', old.id,
					old.chat_id,
					(SELECT title FROM chats WHERE id = old.chat_id),
					old.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = old.chat_id AND topic_id = old.topic_id),
					old.message_id, old.sender_id, old.date, old.text, old.file_name
				);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages_content BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					'delete', old.id,
					old.chat_id,
					(SELECT title FROM chats WHERE id = old.chat_id),
					old.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = old.chat_id AND topic_id = old.topic_id),
					old.message_id, old.sender_id, old.date, old.text, old.file_name
				);
				INSERT INTO messages_fts(rowid, chat_id, chat_title, topic_id, topic_name, message_id, sender_id, date, text, file_name)
				VALUES (
					new.id,
					new.chat_id,
					(SELECT title FROM chats WHERE id = new.chat_id),
					new.topic_id,
					(SELECT topic_name FROM topics WHERE chat_id = new.chat_id AND topic_id = new.topic_id),
					new.message_id, new.sender_id, new.date, new.text, new.file_name
				);
			END;
		`);
	}

	// ── Account ───────────────────────────────────────────────────────────────

	/** The stored account, or the defaults (nothing stored, search enabled) before the first sign-in. */
	public getAccount(): TelegramAccount {
		const row = this.db.prepare('SELECT api_id, api_hash, session, search_enabled FROM account WHERE id = 1').get() as AccountRow | undefined;
		if (!row) return { ...DEFAULT_ACCOUNT };
		return { apiId: row.api_id, apiHash: row.api_hash, session: row.session, searchEnabled: row.search_enabled === 1 };
	}

	/** Stores the given fields of the account, keeping the others as they are. */
	public updateAccount(patch: Partial<TelegramAccount>) {
		const next = { ...this.getAccount(), ...patch };
		this.db
			.prepare(
				`INSERT INTO account (id, api_id, api_hash, session, search_enabled)
				 VALUES (1, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET api_id = excluded.api_id, api_hash = excluded.api_hash,
				 	session = excluded.session, search_enabled = excluded.search_enabled`
			)
			.run(next.apiId, next.apiHash, next.session, next.searchEnabled ? 1 : 0);
	}

	// ── Chats ─────────────────────────────────────────────────────────────────

	public registerChat(id: string, title: string, type: string) {
		this.db
			.prepare(
				`
				INSERT INTO chats (id, title, type) 
				VALUES (?, ?, ?) 
				ON CONFLICT(id) DO UPDATE SET title = ?
			`
			)
			.run(id, title, type, title);
	}

	public getIndexingEnabledChats(): Array<Pick<Chat, 'id' | 'title'>> {
		return this.db.prepare('SELECT id, title FROM chats WHERE indexing_enabled = 1').all() as Array<Pick<Chat, 'id' | 'title'>>;
	}

	public isIndexingEnabled(chatId: string): boolean {
		const row = this.db.prepare('SELECT indexing_enabled FROM chats WHERE id = ?').get(chatId) as Pick<Chat, 'indexing_enabled'> | undefined;
		return row ? row.indexing_enabled === 1 : false;
	}

	public getLastMessageId(chatId: string): number {
		const row = this.db.prepare('SELECT last_message_id FROM indexing_progress WHERE chat_id = ?').get(chatId) as
			| Pick<IndexingProgress, 'last_message_id'>
			| undefined;
		return row ? row.last_message_id : 0;
	}

	/** Advances the cursor; `indexedAt` (epoch ms) is given when the pass stored new messages. */
	public updateLastMessageId(chatId: string, lastMessageId: number, indexedAt: number | null = null) {
		this.db
			.prepare(
				`INSERT INTO indexing_progress (chat_id, last_message_id, last_indexed_at)
				 VALUES (?, ?, ?)
				 ON CONFLICT(chat_id) DO UPDATE SET last_message_id = excluded.last_message_id,
				 	last_indexed_at = COALESCE(excluded.last_indexed_at, last_indexed_at)`
			)
			.run(chatId, lastMessageId, indexedAt);
	}

	/** Records the end of an indexing pass over the chat: when it finished and the error that ended it, if any. */
	public recordChatCheck(chatId: string, checkedAt: number, error: string | null) {
		this.db
			.prepare(
				`INSERT INTO indexing_progress (chat_id, last_message_id, last_checked_at, last_error)
				 VALUES (?, 0, ?, ?)
				 ON CONFLICT(chat_id) DO UPDATE SET last_checked_at = excluded.last_checked_at, last_error = excluded.last_error`
			)
			.run(chatId, checkedAt, error);
	}

	public registerTopic(chatId: string, topicId: number, topicName: string) {
		this.db
			.prepare(
				`INSERT INTO topics (chat_id, topic_id, topic_name)
				 VALUES (?, ?, ?)
				 ON CONFLICT(chat_id, topic_id) DO UPDATE SET topic_name = ?`
			)
			.run(chatId, topicId, topicName, topicName);
	}

	public insertMessages(messages: MessageInput[]) {
		const insert = this.db.prepare(`
			INSERT OR IGNORE INTO messages_content (chat_id, topic_id, message_id, sender_id, date, text, has_media, media_type, file_name, file_size)
			VALUES (@chatId, @topicId, @messageId, @senderId, @date, @text, @hasMedia, @mediaType, @fileName, @fileSize)
		`);

		const insertMany = this.db.transaction((msgs: MessageInput[]) => {
			for (const msg of msgs) {
				const safeMsg = {
					...msg,
					hasMedia: msg.hasMedia ? 1 : 0,
					mediaType: msg.mediaType ?? null,
					fileName: msg.fileName ?? null,
					fileSize: msg.fileSize !== null && msg.fileSize !== undefined ? BigInt(msg.fileSize) : null,
				};
				insert.run(safeMsg);
			}
		});

		insertMany(messages);
	}

	public search(query: string, limit: number = 20): MessageRow[] {
		const match = toFtsMatchExpr(query);
		if (match === null) return [];
		return this.db
			.prepare(
				`
				SELECT * FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?
			`
			)
			.all(match, limit) as MessageRow[];
	}

	public getMessage(chatId: string, messageId: number): MessageRow | undefined {
		return this.db.prepare('SELECT * FROM messages_view WHERE chat_id = ? AND message_id = ?').get(chatId, messageId) as MessageRow | undefined;
	}

	public getChatTitle(chatId: string): string | undefined {
		const row = this.db.prepare('SELECT title FROM chats WHERE id = ?').get(chatId) as Pick<Chat, 'title'> | undefined;
		return row?.title || undefined;
	}

	/**
	 * Search for media files using FTS5.
	 *
	 * Pagination uses a rowid cursor instead of OFFSET so SQLite can seek
	 * directly to the right position rather than scanning and discarding rows.
	 *
	 * @param cursorId  The `id` of the last row returned by the previous page (0 for the first page).
	 * @returns         The current page of rows and the cursor to pass for the next page
	 *                  (`nextCursor === null` means there are no more results).
	 */
	public async searchFiles(query: string, limit: number = 50, cursorId: number = 0): Promise<{ rows: MessageRow[]; nextCursor: number | null }> {
		// better-sqlite3 is synchronous; yield to the event loop before running the
		// query so callers in pagination loops don't starve other async work.
		await new Promise((resolve) => setTimeout(resolve, 0));

		const match = toFtsMatchExpr(query);
		if (match === null) return { rows: [], nextCursor: null };

		const rows = this.db
			.prepare(
				`
				SELECT mv.*, mm.media_verified_at, bm25(messages_fts) AS score
				FROM messages_fts
				JOIN messages_view mv ON mv.id = messages_fts.rowid
				LEFT JOIN messages_metadata mm ON mm.chat_id = mv.chat_id AND mm.message_id = mv.message_id
				WHERE messages_fts MATCH ?
				AND mv.has_media = 1
				AND messages_fts.rowid > ?
				ORDER BY messages_fts.rowid
				LIMIT ?
			`
			)
			.all(match, cursorId, limit) as MessageRow[];

		const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
		return { rows, nextCursor };
	}

	/** Records that Telegram confirmed these media still exist at `verifiedAt` (epoch ms). Other metadata columns are left untouched. */
	public markMediaVerified(refs: MessageRef[], verifiedAt: number) {
		const upsert = this.db.prepare(
			`INSERT INTO messages_metadata (chat_id, message_id, media_verified_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(chat_id, message_id) DO UPDATE SET media_verified_at = ?`
		);
		const upsertMany = this.db.transaction((rows: MessageRef[]) => {
			for (const r of rows) upsert.run(r.chat_id, r.message_id, verifiedAt, verifiedAt);
		});
		upsertMany(refs);
	}

	/** Removes messages from the index along with their metadata; FTS rows go via the delete trigger. */
	public deleteMessages(refs: MessageRef[]) {
		const deleteContent = this.db.prepare('DELETE FROM messages_content WHERE chat_id = ? AND message_id = ?');
		const deleteMetadata = this.db.prepare('DELETE FROM messages_metadata WHERE chat_id = ? AND message_id = ?');
		const deleteMany = this.db.transaction((rows: MessageRef[]) => {
			for (const r of rows) {
				deleteContent.run(r.chat_id, r.message_id);
				deleteMetadata.run(r.chat_id, r.message_id);
			}
		});
		deleteMany(refs);
	}

	public getContext(chatId: string, messageId: number, window: number = 5): MessageRow[] {
		return this.db
			.prepare(
				`
				SELECT * FROM messages_content 
				WHERE chat_id = ? 
				AND message_id BETWEEN ? AND ?
				ORDER BY message_id ASC
			`
			)
			.all(chatId, messageId - window, messageId + window) as MessageRow[];
	}

	public getAllChats(): Chat[] {
		return this.db.prepare('SELECT * FROM chats').all() as Chat[];
	}

	/** Every chat with its index counters and progress, see ChatOverview. Message dates come out as epoch ms. */
	public getChatsOverview(): ChatOverview[] {
		return this.db
			.prepare(
				`SELECT c.id, c.title, c.type, c.indexing_enabled,
					COALESCE(m.message_count, 0) AS message_count,
					COALESCE(m.media_count, 0)   AS media_count,
					COALESCE(m.media_size, 0)    AS media_size,
					m.last_message_at,
					COALESCE(t.topic_count, 0)   AS topic_count,
					COALESCE(p.last_message_id, 0) AS last_message_id,
					p.last_checked_at, p.last_indexed_at, p.last_error
				 FROM chats c
				 LEFT JOIN (
					SELECT chat_id, COUNT(*) AS message_count, SUM(has_media) AS media_count,
						SUM(COALESCE(file_size, 0)) AS media_size, MAX(date) * 1000 AS last_message_at
					FROM messages_content GROUP BY chat_id
				 ) m ON m.chat_id = c.id
				 LEFT JOIN (SELECT chat_id, COUNT(*) AS topic_count FROM topics GROUP BY chat_id) t ON t.chat_id = c.id
				 LEFT JOIN indexing_progress p ON p.chat_id = c.id`
			)
			.all() as ChatOverview[];
	}

	public setChatIndexing(chatId: string, enabled: boolean) {
		this.db
			.prepare(
				`
				UPDATE chats 
				SET indexing_enabled = ? 
				WHERE id = ?
			`
			)
			.run(enabled ? 1 : 0, chatId);
	}

	// Active Downloads management

	public addActiveDownload(row: ActiveDownloadRow) {
		this.db
			.prepare(
				`INSERT INTO active_downloads (hash, chat_id, message_id, file_name, out_path, downloaded_bytes, file_size, status, error_message)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(hash) DO UPDATE SET downloaded_bytes = ?, status = ?, error_message = ?`
			)
			.run(
				row.hash,
				row.chat_id,
				row.message_id,
				row.file_name,
				row.out_path,
				row.downloaded_bytes,
				row.file_size,
				row.status,
				row.error_message ?? null,
				row.downloaded_bytes,
				row.status,
				row.error_message ?? null
			);
	}

	public updateDownloadProgress(hash: string, downloadedBytes: number, status: string, errorMessage?: string | null) {
		this.db
			.prepare(
				`UPDATE active_downloads 
				 SET downloaded_bytes = ?, status = ?, error_message = ? 
				 WHERE hash = ?`
			)
			.run(downloadedBytes, status, errorMessage ?? null, hash);
	}

	public removeActiveDownload(hash: string) {
		this.db.prepare('DELETE FROM active_downloads WHERE hash = ?').run(hash);
	}

	public getActiveDownloads(): ActiveDownloadRow[] {
		return this.db.prepare('SELECT * FROM active_downloads').all() as ActiveDownloadRow[];
	}

	public getActiveDownload(hash: string) {
		return this.db.prepare<[string], ActiveDownloadRow>('SELECT * FROM active_downloads WHERE hash = ?').get(hash);
	}

	public close() {
		this.db.close();
	}
}
