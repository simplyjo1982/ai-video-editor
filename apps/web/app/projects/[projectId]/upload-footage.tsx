'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Result = {name: string; message: string};
export default function UploadFootage({projectId}: {projectId: string}) {
  const [files,setFiles] = useState<File[]>([]);
  const [results,setResults] = useState<Result[]>([]);
  const [busy,setBusy] = useState(false);
  const active = useRef(false);
  const router = useRouter();
  async function upload() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setResults([]);
    const failed: File[] = [];
    try {
      for (const file of files) {
        const slot = `upload:${projectId}:${file.name}:${file.size}:${file.lastModified}`;
        let key = crypto.randomUUID() as string;
        try { key = sessionStorage.getItem(slot) ?? key; sessionStorage.setItem(slot,key); } catch { /* Storage may be disabled; current request still works. */ }
        const base = `/api/projects/${projectId}/uploads`;
        async function send(url: string, options: RequestInit) {
          const response = await fetch(url, {...options, signal: AbortSignal.timeout(60_000)});
          const value = await response.json();
          if (!response.ok) {
            if ([410,415].includes(response.status)) try { sessionStorage.removeItem(slot); } catch { /* Browser storage is optional. */ }
            throw new Error(typeof value.error === 'string' ? value.error : 'Upload failed. Retry this file.');
          }
          return value;
        }
        try {
          setResults(previous => [...previous, {name: file.name, message: 'Uploading…'}]);
          const reservation = await send(base, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: file.name,size: file.size,type: file.type,key})});
          if (reservation.status !== 'uploaded') {
            let offset = reservation.offset as number;
            while (offset < file.size) {
              const result = await send(`${base}/${reservation.id}`, {method:'PUT', headers:{'Content-Type':'application/octet-stream','Upload-Offset':String(offset)},
                body:file.slice(offset,offset+reservation.chunkBytes)});
              offset = result.offset;
              setResults(previous => previous.map((row,index) => index === previous.length-1 ? {...row,message:`Uploading ${Math.floor(offset/file.size*100)}%`} : row));
            }
            await send(`${base}/${reservation.id}`, {method:'POST'});
          }
          try { sessionStorage.removeItem(slot); } catch { /* Browser storage is optional. */ }
          setResults(previous => previous.map((row,index) => index === previous.length-1 ? {...row,message:'Uploaded'} : row));
        } catch (error) {
          failed.push(file);
          const message = error instanceof Error && error.message !== 'Failed to fetch' && error.name !== 'TimeoutError' ? error.message : 'Connection interrupted. Retry this file to resume.';
          setResults(previous => previous.map((row,index) => index === previous.length-1 ? {...row,message} : row));
        }
      }
    } finally {
      setFiles(failed);
      setBusy(false);
      active.current = false;
      router.refresh();
    }
  }
  return <div className="mt-5 rounded-lg bg-slate-50 p-5">
    <label htmlFor="footage-files" className="block font-medium">Upload Footage</label>
    <p id="upload-help" className="mt-2 text-sm text-slate-600">Choose MP4, MOV, or M4V files. Uploads are stored as originals; processing comes later. If interrupted, reselect the same file in this tab to resume.</p>
    <input id="footage-files" type="file" multiple accept=".mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v" disabled={busy}
      aria-describedby="upload-help" className="mt-4 block w-full text-sm" onChange={event => setFiles(Array.from(event.target.files ?? []))} />
    <button type="button" disabled={busy || !files.length} onClick={() => void upload()} className="mt-4 rounded-lg bg-slate-900 px-5 py-3 text-white disabled:opacity-50">{busy ? 'Uploading…' : 'Upload selected files'}</button>
    <ul aria-live="polite" className="mt-4 space-y-2 text-sm">{results.map((result,index) => <li key={index} className="break-words"><strong>{result.name}</strong>: {result.message}</li>)}</ul>
  </div>;
}
