'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function StatusRefresh(){
  const router=useRouter();
  useEffect(()=>{const timer=setInterval(()=>router.refresh(),2000);return()=>clearInterval(timer);},[router]);
  return <p className="mt-2 text-sm text-slate-500">Status updates automatically while technical processing runs.</p>;
}
