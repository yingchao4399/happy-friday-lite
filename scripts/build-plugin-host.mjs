import {build} from 'esbuild'
import {writeGeneratedOutputs} from './write-generated-output.mjs'
const result=await build({write:false,entryPoints:['src/features/plugins/runtime.js'],outfile:'src-electron/plugins/runtime.bundle.js',bundle:true,format:'iife',platform:'browser',target:'chrome148',minify:true,logLevel:'warning'})
await writeGeneratedOutputs(result.outputFiles)
