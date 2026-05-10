/**
 * @fileoverview Shared session lifecycle helpers for Pi web tools.
 */
import {
	buildSessionNotice,
	buildSessionText,
	deleteSessionAndStorage,
	saveSessionToStorage,
} from "../../http/session.ts";

export interface SessionLifecycleParams {
	sessionId?: string;
	saveSession?: boolean;
	clearSession?: boolean;
}

export interface SessionLifecycleResult {
	notice: string | undefined;
	suffix: string;
}

/**
 * Apply save/clear session side effects and return notice + suffix text.
 */
export async function sessionLifecycle(
	params: SessionLifecycleParams,
): Promise<SessionLifecycleResult> {
	if (params.sessionId) {
		if (params.saveSession) await saveSessionToStorage(params.sessionId);
		if (params.clearSession) await deleteSessionAndStorage(params.sessionId);
	}
	return {
		notice: buildSessionNotice(params),
		suffix: buildSessionText(params),
	};
}

export { buildSessionNotice, buildSessionText };
