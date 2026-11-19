const endpoint=document.getElementById('endpoint'),token=document.getElementById('token'),status=document.getElementById('status');
chrome.storage.local.get(['endpoint','token'],settings=>{endpoint.value=settings.endpoint||'http://127.0.0.1:41185';token.value=settings.token||'';});
document.getElementById('clip').onclick=async()=>{
  const button=document.getElementById('clip');button.disabled=true;status.textContent='正在剪藏…';
  try{
    const url=new URL(endpoint.value);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('请输入本机 HTTP 服务地址');
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const selectionOnly=document.getElementById('selection').checked;
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[selectionOnly],func:preferSelection=>{const selection=getSelection();let html='';if(preferSelection&&selection?.rangeCount&&!selection.isCollapsed){const div=document.createElement('div');div.append(selection.getRangeAt(0).cloneContents());html=div.innerHTML;}else{const main=document.querySelector('article')||document.querySelector('main')||document.body;const clone=main.cloneNode(true);clone.querySelectorAll('script,style,iframe,object,form,nav,footer').forEach(el=>el.remove());html=clone.innerHTML;}return {title:document.title,url:location.href,html};}});
    const response=await fetch(url.origin+'/clip',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token.value},body:JSON.stringify(result[0].result)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'剪藏失败');await chrome.storage.local.set({endpoint:url.origin,token:token.value});status.textContent='已保存：'+value.path;
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
