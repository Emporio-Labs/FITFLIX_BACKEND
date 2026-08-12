// Fix for Bun issue where process.getBuiltinModule('v8').startupSnapshot.isBuildingSnapshot() throws NotImplementedError in bson/mongoose
if (typeof globalThis.process?.getBuiltinModule === "function") {
	const origGetBuiltinModule = globalThis.process.getBuiltinModule;
	globalThis.process.getBuiltinModule = function (id: string) {
		const mod = origGetBuiltinModule.call(this, id);
		if (id === "v8" && mod?.startupSnapshot) {
			return {
				...mod,
				startupSnapshot: {
					...mod.startupSnapshot,
					isBuildingSnapshot: () => false,
				},
			};
		}
		return mod;
	};
}
