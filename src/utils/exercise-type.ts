/**
 * Best-effort guess at whether an exercise name is a cardio exercise done for
 * time. Only used to backfill rows created before `exerciseType` existed —
 * new exercises carry an explicit type chosen when they are created.
 */
const CARDIO_PATTERNS: RegExp[] = [
	/treadmill/,
	/stair ?master|stair ?climb|step ?mill|stair ?mill/,
	/elliptical|cross ?trainer/,
	/rowing machine|\brower\b|rowing,? stationary|ergometer|ski ?erg/,
	/stationary bike|exercise bike|recumbent bike|spin bike|spinning|assault bike|air ?bike|airdyne|bicycling|\bcycling\b/,
	/\bjogging\b|\brunning\b|\bsprints?\b|brisk walk|incline walk|walking,? treadmill/,
	/\bjump rope\b|rope jumping|\bskipping\b/,
	/\bswimming\b|\bhiking\b|\bskating\b/,
];

// "Running man", "rowing" as a strength pull, etc. are strength moves.
const NOT_CARDIO: RegExp[] = [/running man/, /upright row|bent.?over row|cable row|dumbbell row|barbell row/];

export const looksLikeCardio = (name: string): boolean => {
	const n = name.toLowerCase();
	if (NOT_CARDIO.some((re) => re.test(n))) return false;
	return CARDIO_PATTERNS.some((re) => re.test(n));
};
