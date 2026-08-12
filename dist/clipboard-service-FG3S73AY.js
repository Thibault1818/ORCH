#!/usr/bin/env node
import {a as a$1}from'./chunk-BPWQ434U.js';import {c,h,f}from'./chunk-UQEE676R.js';import {a}from'./chunk-CDVPC44Y.js';import {accessSync,constants,statSync}from'fs';import {mkdtemp,readFile,unlink,rm}from'fs/promises';import {tmpdir}from'os';import {join,isAbsolute,delimiter,resolve}from'path';var E=3e3,I=64*1024,_=50*1024*1024,F=64*1024,M=new c(new a),o=new Map;function H(){let t=process.platform;return t==="darwin"?true:t==="linux"?W("xclip"):t==="win32"}async function O(){let t=process.platform;if(t==="darwin")return v();if(t==="linux")return D();if(t==="win32")return k();throw new a$1(`Unsupported platform for clipboard: ${t}`,1,"Supported: macOS, Linux, Windows")}async function K(){if(await O()!=="image")return null;let e=process.platform;return e==="darwin"?A():e==="linux"?R():e==="win32"?B():null}async function v(){try{let{stdout:t}=await n("osascript",["-e","clipboard info"]);return t.includes("\xABclass PNGf\xBB")||t.includes("\xABclass TIFF\xBB")?"image":t.includes("\xABclass ut16\xBB")||t.includes("\xABclass utf8\xBB")||t.trim().length>0?"text":"empty"}catch{return "empty"}}async function A(){let t=await mkdtemp(join(tmpdir(),"orch-clip-")),e=join(t,"clipboard.png");try{let i=`
      set theFile to POSIX file "${e}"
      try
        set imgData to the clipboard as \xABclass PNGf\xBB
        set fRef to open for access theFile with write permission
        write imgData to fRef
        close access fRef
        return "ok"
      on error
        try
          close access theFile
        end try
        return "error"
      end try
    `,{stdout:r}=await n("osascript",["-e",i]);return r.trim()!=="ok"?null:{data:await readFile(e),ext:"png"}}catch{return null}finally{try{await unlink(e);}catch{}try{await rm(t,{recursive:!0});}catch{}}}async function D(){try{let{stdout:t}=await n("xclip",["-selection","clipboard","-t","TARGETS","-o"]),e=t.toLowerCase();return e.includes("image/png")||e.includes("image/tiff")||e.includes("image/jpeg")?"image":e.includes("text/plain")||e.includes("utf8_string")||e.includes("string")||e.trim().length>0?"text":"empty"}catch{return "empty"}}async function R(){try{let{stdoutBuffer:t}=await n("xclip",["-selection","clipboard","-t","image/png","-o"],_),e=t;return e.length===0?null:{data:e,ext:"png"}}catch{return null}}async function k(){try{let{stdout:t}=await n("powershell.exe",["-NoProfile","-Command",'if (Get-Clipboard -Format Image) { "image" } else { "none" }']);if(t.trim()==="image")return "image";let{stdout:e}=await n("powershell.exe",["-NoProfile","-Command",'if (Get-Clipboard) { "text" } else { "empty" }']);return e.trim()==="text"?"text":"empty"}catch{return "empty"}}async function B(){let t=await mkdtemp(join(tmpdir(),"orch-clip-")),e=join(t,"clipboard.png");try{let i=`
      Add-Type -AssemblyName System.Windows.Forms
      $img = [System.Windows.Forms.Clipboard]::GetImage()
      if ($img) {
        $img.Save('${e.replace(/\\/g,"\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output 'ok'
      } else {
        Write-Output 'error'
      }
    `,{stdout:r}=await n("powershell.exe",["-NoProfile","-Command",i]);return r.trim()!=="ok"?null:{data:await readFile(e),ext:"png"}}catch{return null}finally{try{await unlink(e);}catch{}try{await rm(t,{recursive:!0});}catch{}}}async function n(t,e,i=I){let r=await M.run({executable:await G(t),args:e,env:process.env,timeoutMs:E,maxStdoutBytes:i,maxStderrBytes:F});if(!r.ok)throw new Error(h(r));return r}function G(t){let e=o.get(t);return e||(e=f(t),o.set(t,e),e.catch(()=>{o.get(t)===e&&o.delete(t);})),e}function W(t){if(isAbsolute(t))return m(t);for(let e of (process.env.PATH??"").split(delimiter).filter(Boolean))if(m(resolve(e,t)))return  true;return  false}function m(t){try{return accessSync(t,constants.X_OK),statSync(t).isFile()}catch{return  false}}export{O as detectClipboardType,K as getClipboardImage,H as isClipboardToolAvailable};