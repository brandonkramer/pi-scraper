/**
 * @fileoverview Section inspection operation.
 */
import {
	extractSectionRanges,
	SectionRangeError,
	type SectionRangeRequest,
} from "../../shared/section-ranges.ts";
import { PatternInspectError } from "../errors.ts";

export function inspectSections(
	content: string,
	requests: SectionRangeRequest[],
	url?: string,
) {
	try {
		return extractSectionRanges(content, requests);
	} catch (error) {
		if (error instanceof SectionRangeError) {
			throw new PatternInspectError(
				error.message,
				"PATTERN_INPUT_INVALID",
				url,
			);
		}
		throw error;
	}
}
