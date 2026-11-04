(() => {
const tg=window.Telegram?.WebApp; tg?.ready(); tg?.expand(); tg?.setHeaderColor?.("#080808"); tg?.setBackgroundColor?.("#080808");
const $=id=>document.getElementById(id); let mode="ask",busy=false;
const modes={solve:["Решить задачу","Пришли условие — покажу краткое решение по шагам."],summary:["Конспект","Вставь текст или отправь учебный материал."],explain:["Репетитор","Какую тему объяснить простыми словами?"],search:["Поиск по теме","Найду материалы и подготовлю короткий ответ."],test:["Тесты","Генератор тестов скоро появится."],check:["Проверить решение","Вставь условие и своё решение для проверки."],cards:["Карточки","Карточки для повторения скоро появятся."],schemes:["Схемы","Создание учебных схем скоро появится."],library:["Моя библиотека","Загрузка файлов доступна. Сохранённая библиотека появится следующим этапом."]};
function toast(s){$("toast").textContent=s;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2800)}
function screen(name){document.querySelectorAll(".screen").forEach(x=>x.classList.toggle("active",x.id===name));document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.screen===name))}
function openMode(m){mode=m;const d=modes[m]||["STUDY AI","Напиши свой вопрос."];$("workspace-title").textContent=d[0];$("workspace-hint").textContent=d[1];$("mode-label").textContent="ИНСТРУМЕНТ";if(!$("messages").children.length)$("messages").innerHTML='<div class="welcome-msg">'+d[1]+'</div>';screen("workspace");}
document.querySelectorAll(".tool").forEach(b=>b.addEventListener("click",()=>{const m=b.dataset.mode;if(["test","cards","schemes","library","check"].includes(m)){openMode(m);if(m==="library")toast("Прикрепи файл — я обработаю его");return}openMode(m)}));
document.querySelectorAll(".nav[data-screen]").forEach(b=>b.addEventListener("click",()=>screen(b.dataset.screen)));
$("back").onclick=()=>screen("home");$("profile").onclick=()=>toast(tg?.initDataUnsafe?.user?.first_name||"Профиль Telegram");
function renderAnswer(raw){
const escape=s=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let html=escape(String(raw||"")).replace(/\r/g,"");
html=html.replace(/^###?\s+(.+)$/gm,"<h3>$1</h3>");
html=html.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/__(.+?)__/g,"<strong>$1</strong>");
html=html.replace(/\*([^*\n]+)\*/g,"<em>$1</em>");
html=html.replace(/\`([^\`]+)\`/g,"<code>$1</code>");
html=html.replace(/^\s*[-•]\s+(.+)$/gm,"<li>$1</li>");
html=html.replace(/(?:<li>.*<\/li>\n?)+/gs,m=>"<ul>"+m+"</ul>");
html=html.split(/\n{2,}/).map(part=>part.startsWith("<h3>")||part.startsWith("<ul>")?part:"<p>"+part.replace(/\n/g,"<br>")+"</p>").join("");
return html;
}
function addImage(item){if(!item?.url)return;const wrap=document.createElement("figure");wrap.className="topic-image";const img=document.createElement("img");img.src=item.url;img.alt=item.title||"Иллюстрация к теме";img.loading="lazy";img.referrerPolicy="no-referrer";wrap.append(img);if(item.title){const cap=document.createElement("figcaption");cap.textContent=item.title+(item.license?" · "+item.license:"");wrap.append(cap)}if(item.pageUrl){const link=document.createElement("a");link.href=item.pageUrl;link.target="_blank";link.rel="noopener noreferrer";link.textContent="Источник изображения";wrap.append(link)}$("messages").append(wrap);$("messages").scrollTop=$("messages").scrollHeight}\nfunction addBubble(text,who){const el=document.createElement("div");el.className="bubble "+who;if(who==="ai")el.innerHTML=renderAnswer(text);else el.textContent=text;$("messages").append(el);$("messages").scrollTop=$("messages").scrollHeight;return el}
async function request(question){if(busy)return;const initData=tg?.initData;if(!initData){toast("Открой приложение через кнопку в Telegram.");return}busy=true;addBubble(question,"user");const loading=addBubble("STUDY AI думает…","loading");try{const r=await fetch("/api/ask",{method:"POST",headers:{"content-type":"application/json","x-telegram-init-data":initData},body:JSON.stringify({question,mode})});const data=await r.json();loading.remove();if(!r.ok)throw new Error(data.error||"Ошибка запроса");addBubble(data.answer||"Нет ответа","ai");(data.images||[]).forEach(addImage)}catch(e){loading.remove();addBubble(e.message,"ai")}finally{busy=false}}
function sendFrom(id){const q=$(id).value.trim();if(!q)return;$(id).value="";request(q)}
$("send").onclick=()=>{const q=$("question").value.trim();if(!q)return;mode="ask";openMode("ask");$("question").value="";request(q)};
$("workspace-send").onclick=()=>sendFrom("workspace-question");
for(const id of ["question","workspace-question"]){const field=$(id);field.addEventListener("input",()=>{field.style.height="auto";field.style.height=Math.min(field.scrollHeight,112)+"px"})}
$("question").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("send").click()}});
$("workspace-question").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendFrom("workspace-question")}});
async function uploadFile(file){if(!file)return;if(!tg?.initData){toast("Открой приложение через Telegram.");return}const allowed=/\.(pdf|docx|txt|md|png|jpe?g|webp)$/i;if(!allowed.test(file.name)){toast("Формат не поддерживается.");return}if(file.size>15*1024*1024){toast("Файл больше 15 МБ.");return}screen("workspace");addBubble("Файл: "+file.name,"user");const loading=addBubble("Анализирую файл…","loading");const form=new FormData();form.append("file",file);try{const r=await fetch("/api/upload",{method:"POST",headers:{"x-telegram-init-data":tg.initData},body:form});const data=await r.json();loading.remove();if(!r.ok)throw new Error(data.error||"Не удалось обработать файл");addBubble(data.answer,"ai");(data.images||[]).forEach(addImage)}catch(e){loading.remove();addBubble(e.message,"ai")}}
$("file").onchange=e=>uploadFile(e.target.files[0]);$("workspace-file").onchange=e=>uploadFile(e.target.files[0]);
})();