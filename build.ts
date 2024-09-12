import * as bun  from "bun"
import * as fsp  from "fs/promises"
import * as fs   from "fs"
import * as path from "path"
import * as os   from "os"

let data_file_path = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'comptime-')), "comptime_data.json")

let entry = /*js*/`
import * as fs from "fs"

let comptime_data = {}

globalThis.comptime = fn => {
	let stack = new Error().stack
	if (!stack) {
		throw new Error("Couldn't get error stack.")
	}
	let caller_location = stack.split("\\n")[2]

	let idx_of_paren = caller_location.indexOf("(")
	if (idx_of_paren === -1 || caller_location[caller_location.length-1] !== ')') {
		throw new Error("Couldn't parse comptime() caller location.")
	}
	caller_location = caller_location.slice(idx_of_paren+1, caller_location.length-1)

	return eval_value(fn())

	function eval_value(v) {
		if (v instanceof Promise) {
			return v.then(eval_value)
		}

		if (typeof v !== "string") {
			throw new Error("Value returned from comptime() is not a string.")
		}

		let value_eval
		try {
			value_eval = eval("("+v+")")
		} catch (err) {
			throw new Error("Value returned from comptime() couldn't be evaluated.", {cause: err})
		}

		comptime_data[caller_location] = v

		return value_eval
	}
}

await import("./index.ts")

fs.writeFileSync("${data_file_path}", JSON.stringify(comptime_data))
`

await bun.$`echo ${entry} | bun run -`

fs.rmSync("dist", {recursive: true, force: true})

let comptime_data = JSON.parse(fs.readFileSync(data_file_path, "utf-8")) as Record<string, string>

const FN_NAME = "comptime"

let build_res = await bun.build({
	entrypoints: ["./index.ts"],
	outdir:      "dist",
	plugins: [{
		name: "comptime",
		setup(build) {

			build.onLoad({ filter: /\.ts$/ }, async (args) => {
				let source = await fsp.readFile(args.path, "utf-8")
				let source_new = ""

				let last_pos = 0
				for (;;) {
					let idx_of_fn = source.indexOf(FN_NAME, last_pos)
					
					if (idx_of_fn === -1) {
						source_new += source.slice(last_pos)
						break
					}

					source_new += source.slice(last_pos, idx_of_fn)
					last_pos = idx_of_fn+FN_NAME.length

					let line = 1, col = 1
					for (let i = 0; i < idx_of_fn; i++) {
						if (source[i] === '\n') {
							line++
							col = 1
						} else {
							col++
						}
					}

					let key = args.path+":"+line+":"+col
					if (!(key in comptime_data)) {
						source_new += FN_NAME
						console.error("No comptime value for", key)
						continue
					}

					let idx_of_paren = skip_whitespace_and_comments(source, idx_of_fn+FN_NAME.length)
					if (source[idx_of_paren] !== "(") {
						source_new += FN_NAME
						console.error("Couldn't find paren open")
						continue
					}

					let idx_of_closing_paren = find_closing_paren(source, idx_of_paren)
					if (idx_of_closing_paren === -1) {
						source_new += FN_NAME
						console.error("Couldn't find paren close")
						continue
					}

					source_new += "("+comptime_data[key]+");"
					last_pos = idx_of_closing_paren+1
				}

				return {
					contents: source_new,
					loader: args.loader,
				}
			})
		}
	}]
})

if (build_res.logs.length > 0) {
	console.log("Build logs:")
	for (const log of build_res.logs) {
		console.log(log)
	}
}

function skip_whitespace_and_comments(src: string, i: number): number {
	let in_block_comment = false
	let in_line_comment  = false

	for (; i < src.length; i++) {

		if (in_block_comment) {
			if (src[i] === '*' && src[i+1] === '/') {
				in_block_comment = false
				i += 1 // Skip closing '*/'
			}
			continue
		}

		if (in_line_comment) {
			if (src[i] === '\n') {
				in_line_comment = false
			}
			continue
		}

		if (src[i] === '/' && src[i+1] === '*') {
			in_block_comment = true
			i += 1 // Skip opening '/*'
			continue
		}

		if (src[i] === '/' && src[i+1] === '/') {
			in_line_comment = true
			i += 1 // Skip opening '//'
			continue
		}

		if (/\s/.test(src[i])) {
			continue
		}

		break
	}

	return i
}

function find_closing_paren(src: string, i: number): number {
	if (src[i] !== '(') {
		throw new Error('No opening parenthesis at the given position')
	}

	let depth = 1
	let in_single_quote = false
	let in_double_quote = false
	let in_backtick     = false

	for (i += 1; i < src.length; i++) {

		if (!in_single_quote && !in_double_quote && !in_backtick) {
			i = skip_whitespace_and_comments(src, i)
		}

		if (!in_double_quote && !in_backtick && src[i] === "'" && src[i-1] !== '\\') {
			in_single_quote = !in_single_quote
			continue
		}

		if (!in_single_quote && !in_backtick && src[i] === '"' && src[i-1] !== '\\') {
			in_double_quote = !in_double_quote
			continue
		}

		if (!in_single_quote && !in_double_quote && src[i] === '`' && src[i-1] !== '\\') {
			in_backtick = !in_backtick
			continue
		}

		if (in_single_quote || in_double_quote || in_backtick) {
			continue
		}

		if (src[i] === '(') {
			depth++
		} else if (src[i] === ')' && --depth === 0) {
			return i
		}
	}

	return -1
}
