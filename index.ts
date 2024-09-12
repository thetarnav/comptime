import * as bun  from "bun"
import * as path from "node:path"
import * as fsp  from "node:fs/promises"

const now = comptime(() => {
	let now = Date.now()
	let now_hash = bun.hash(now+"")
	let basename = JSON.stringify(path.basename(process.cwd()))
	return `[${now}, ${now}, ${now_hash}, ${basename}]` as any as any[]
})

console.log("Compiled at: ", now)

const deps = await comptime(async () => {
	let str = await fsp.readFile("package.json", "utf-8")
	let pkg = JSON.parse(str) as Record<string, any>
	let deps = Object.keys({...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies})
	return JSON.stringify(deps) as any as string[]
})
console.log("deps:", deps)

const people = await comptime(async () => {
	let data = await (await fetch('https://swapi.dev/api/people/')).json()
	let people = data.results.slice(0, 5).map((c: any) => c.name)
	return JSON.stringify(people) as any as string[]
})
console.log("people:", people)

