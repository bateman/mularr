import type { Extension, ExtensionType } from '../../../services/ExtensionsApiService';

/** Values a type-specific config form contributes to the extension: its endpoint and its `config` JSON. */
export interface ConfigFormValues {
	url: string;
	config: Record<string, unknown>;
}

/**
 * Imperative surface a config form exposes to ExtensionForm, which owns the Save/Test buttons.
 * The config form fills it in while rendering; the form reads it when a button is pressed.
 */
export interface ConfigFormHandle {
	/** Validated values, or a message for the user when the form is not valid yet. */
	read?: () => ConfigFormValues | { error: string };
	/** Present when the type can check its settings against the remote service; resolves with a message. */
	test?: () => Promise<string>;
}

export interface ConfigFormProps {
	type: ExtensionType;
	/** Present when editing; absent when creating. */
	extension?: Extension;
	handle: ConfigFormHandle;
}
