declare global {
	var comptime: <T>(fn: () => T) => T
	// interface ImportMeta {
	// }
}

export {}
