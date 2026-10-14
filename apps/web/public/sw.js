// Notification-only service worker: never cache private portfolio/API responses.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
 let payload={};try{payload=event.data?event.data.json():{};}catch{}
 const title=typeof payload.title==='string'?payload.title.slice(0,120):'PortRhythm';
 const body=typeof payload.body==='string'?payload.body.slice(0,200):'새 공지가 있습니다.';
 let url='/';try{const candidate=new URL(payload.url,self.location.origin);if(candidate.origin===self.location.origin&&candidate.pathname==='/')url=candidate.pathname+candidate.search;}catch{}
 event.waitUntil(self.registration.showNotification(title,{body,icon:'/brand/portrhythm-logo-192.png',badge:'/brand/portrhythm-logo-192.png',tag:typeof payload.tag==='string'?payload.tag:'portrhythm',data:{url}}));
});
self.addEventListener('notificationclick', event => {
 event.notification.close();
 const target=new URL(event.notification.data?.url||'/',self.location.origin);
 if(target.origin!==self.location.origin)return;
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows){if(new URL(client.url).origin===target.origin){try { await client.navigate(target.href);return await client.focus(); } catch {}}}return self.clients.openWindow(target.href);})());
});
