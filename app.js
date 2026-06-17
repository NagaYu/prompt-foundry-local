/* =============================================================================
 * PromptFoundry Local — app.js
 * -----------------------------------------------------------------------------
 * 100% browser-local prompt forging engine.
 *  - Local Intent Engine : Transformers.js + WebGPU (WASM fallback), in a Worker
 *  - Prompt Forger       : turns words/bullets into image + text + system prompts
 *  - i18n                : 9-language UI (ja/en/zh/ko/es/fr/ar/de/hi) incl. RTL
 *
 * No backend. No external AI API. No telemetry. The only network traffic is the
 * one-time download of the model weights + library from a CDN (then cached by
 * the browser). Inference happens entirely on the user's device.
 * ========================================================================== */

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';

/* Fully-offline first run (opt-in):
 *   1. run  ./download-model.sh  to fetch the model into ./models/
 *   2. set  USE_LOCAL_MODEL = true  below
 * Then even the very first launch needs no network at all. Default = false
 * (weights stream once from the CDN, then the browser caches them offline). */
const USE_LOCAL_MODEL = false;
const MODELS_BASE = new URL('./models/', location.href).href;

/* -----------------------------------------------------------------------------
 * 1. WORKER  (built from a Blob so the whole app stays a clean 3-file project)
 *    All heavy lifting — model load + token generation — runs here, off the main
 *    thread, so the UI never freezes during the first multi-hundred-MB download.
 * -------------------------------------------------------------------------- */
const WORKER_SRC = `
import { AutoModelForCausalLM, AutoTokenizer, TextStreamer, env }
  from "${TRANSFORMERS_CDN}";

// Model source. Local-bundled (fully offline) when enabled, else CDN-then-cache.
// The browser caches downloaded weights, so there is never a per-inference call.
env.useBrowserCache = true;
if (${USE_LOCAL_MODEL}) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = ${JSON.stringify(MODELS_BASE)};
} else {
  env.allowLocalModels = false;
}

let tokenizer = null, model = null, loadedId = null, activeDevice = null;

async function pickDevice() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try { if (await navigator.gpu.requestAdapter()) return 'webgpu'; } catch (_) {}
  }
  return 'wasm';
}

async function ensureLoaded(modelId) {
  if (model && loadedId === modelId) return activeDevice;

  // Reset when switching models.
  model = null; tokenizer = null; loadedId = null;

  let device = await pickDevice();
  self.postMessage({ type: 'device', device });

  const progress = p => self.postMessage({ type: 'progress', data: p });
  const dtypeFor = d => (d === 'webgpu' ? 'q4f16' : 'q4');

  const tryLoad = async (dev) => {
    tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback: progress });
    model = await AutoModelForCausalLM.from_pretrained(modelId, {
      dtype: dtypeFor(dev), device: dev, progress_callback: progress,
    });
  };

  try {
    await tryLoad(device);
  } catch (err) {
    // Graceful fallback: WebGPU adapter present but model/op unsupported -> WASM.
    if (device === 'webgpu') {
      device = 'wasm';
      self.postMessage({ type: 'device', device });
      model = null; tokenizer = null;
      await tryLoad(device);
    } else {
      throw err;
    }
  }

  loadedId = modelId; activeDevice = device;
  self.postMessage({ type: 'ready', device });
  return device;
}

async function generate({ reqId, modelId, system, user, max_new_tokens }) {
  await ensureLoaded(modelId);

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true, return_dict: true,
  });

  let acc = '';
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true, skip_special_tokens: true,
    callback_function: (t) => { acc += t; self.postMessage({ type: 'token', reqId, token: t }); },
  });

  await model.generate({
    ...inputs,
    max_new_tokens: max_new_tokens || 320,
    do_sample: true, temperature: 0.4, top_p: 0.9, top_k: 40, repetition_penalty: 1.2, no_repeat_ngram_size: 3,
    streamer,
  });

  self.postMessage({ type: 'result', reqId, text: acc.trim() });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'preload')  { await ensureLoaded(msg.modelId); }
    else if (msg.type === 'generate') { await generate(msg); }
  } catch (err) {
    self.postMessage({ type: 'error', reqId: msg.reqId, error: String(err && err.message || err) });
  }
};
`;

let worker = null;
const pending = new Map(); // reqId -> { resolve, reject, onToken }

function bootWorker() {
  if (worker) return worker;
  const blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
  worker = new Worker(URL.createObjectURL(blob), { type: 'module' });

  worker.onmessage = (e) => {
    const m = e.data;
    switch (m.type) {
      case 'device':   onDeviceDetected(m.device); break;
      case 'progress': onProgress(m.data); break;
      case 'ready':    onModelReady(m.device); break;
      case 'token': {
        const p = pending.get(m.reqId);
        if (p && p.onToken) p.onToken(m.token);
        break;
      }
      case 'result': {
        const p = pending.get(m.reqId);
        if (p) { pending.delete(m.reqId); p.resolve(m.text); }
        break;
      }
      case 'error': {
        const p = pending.get(m.reqId);
        if (p) { pending.delete(m.reqId); p.reject(new Error(m.error)); }
        else console.error('[worker]', m.error);
        break;
      }
    }
  };
  worker.onerror = (e) => console.error('[worker:fatal]', e.message || e);
  return worker;
}

let reqCounter = 0;
function runLLM({ system, user, max_new_tokens, onToken }) {
  const reqId = ++reqCounter;
  const w = bootWorker();
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject, onToken });
    w.postMessage({
      type: 'generate', reqId,
      modelId: state.modelId, system, user, max_new_tokens,
    });
  });
}

/* -----------------------------------------------------------------------------
 * 2. i18n  — full UI translations for 9 languages (Arabic is RTL).
 * -------------------------------------------------------------------------- */
const LANGS = [
  { code: 'ja', label: '日本語',   name: 'Japanese' },
  { code: 'en', label: 'English',  name: 'English' },
  { code: 'zh', label: '中文',     name: 'Chinese' },
  { code: 'ko', label: '한국어',   name: 'Korean' },
  { code: 'es', label: 'Español',  name: 'Spanish' },
  { code: 'fr', label: 'Français', name: 'French' },
  { code: 'de', label: 'Deutsch',  name: 'German' },
  { code: 'ar', label: 'العربية',  name: 'Arabic' },
  { code: 'hi', label: 'हिन्दी',   name: 'Hindi' },
];
const RTL = new Set(['ar']);

const I18N = {
  ja: { subtitle:'単語から、完璧なAIプロンプトを鋳造する。', badgeLocal:'100% Local', badgeCost:'API Cost $0', deviceDetecting:'検出中…', inputLabel:'あなたの意図', sampleBtn:'例を入れる', inputPlaceholder:'例: 夕暮れ・海辺・猫・映画的・孤独', modeLabel:'鋳造モード', modeBoth:'両方', modeImage:'画像', modeText:'テキスト', outLangLabel:'出力プロンプトの言語', imgEnNote:'※ 画像プロンプトは互換性のため常に英語で鋳造されます。', modelLabel:'ローカルLLMモデル', modelNote:'初回のみブラウザにキャッシュ。以降はオフライン動作。', forgeBtn:'プロンプトを鋳造する', privacyNote:'入力はこの端末から一切送信されません。', statusLabel:'AI意図予測ステータス', statusIdle:'待機中 — エンジン未起動', liveLabel:'推論ライブビュー', savedTotal:'この端末での累計削減コスト', forgeCount:'鋳造回数', imgCardTitle:'画像生成プロンプト', imgCardSub:'Midjourney / Stable Diffusion 用 (English)', copyBtn:'コピー', negTitle:'ネガティブプロンプト', emptyOut:'— まだ鋳造されていません —', saved:'削減', textCardTitle:'テキスト生成プロンプト', textCardSub:'ChatGPT / Claude 用 — 構造化プロンプト', sysCardTitle:'システム設定プロンプト', sysCardSub:'3つの哲学 — ローカル完結・データ主権・コスト削減', footerTag:'外部通信なし / 運営コスト0円 / 情報漏洩0%', downloading:'モデルをダウンロード中…', stLoading:'ローカルLLMを起動中…', stPredicting:'意図を予測中…', stForgingImg:'画像プロンプトを鋳造中…', stForgingText:'テキストプロンプトを鋳造中…', stDone:'鋳造完了 ✓', stReady:'エンジン準備完了', stError:'エラーが発生しました', copied:'コピーしました', needInput:'まず単語や箇条書きを入力してください。' },

  en: { subtitle:'Forge perfect AI prompts from a few words.', badgeLocal:'100% Local', badgeCost:'API Cost $0', deviceDetecting:'Detecting…', inputLabel:'Your Intent', sampleBtn:'Insert example', inputPlaceholder:'e.g. dusk · seaside · cat · cinematic · solitude', modeLabel:'Forge Mode', modeBoth:'Both', modeImage:'Image', modeText:'Text', outLangLabel:'Output prompt language', imgEnNote:'Image prompts are always forged in English for compatibility.', modelLabel:'Local LLM model', modelNote:'Cached in your browser on first run. Works offline afterwards.', forgeBtn:'Forge Prompts', privacyNote:'Your input never leaves this device.', statusLabel:'AI Intent Prediction', liveLabel:'Inference live view', savedTotal:'Total cost saved on this device', forgeCount:'Forges', imgCardTitle:'Image Generation Prompt', imgCardSub:'For Midjourney / Stable Diffusion (English)', copyBtn:'Copy', negTitle:'Negative prompt', emptyOut:'— not forged yet —', saved:'Saved', textCardTitle:'Text Generation Prompt', textCardSub:'For ChatGPT / Claude — structured prompt', sysCardTitle:'System Setup Prompt', sysCardSub:'3 philosophies — local-first, data sovereignty, cost-zero', footerTag:'No external calls / $0 to run / 0% data leakage', downloading:'Downloading model…', stLoading:'Booting local LLM…', stPredicting:'Predicting intent…', stForgingImg:'Forging image prompt…', stForgingText:'Forging text prompt…', stDone:'Forge complete ✓', stReady:'Engine ready', stError:'An error occurred', copied:'Copied to clipboard', needInput:'Enter some words or bullet points first.' },

  zh: { subtitle:'用几个词，铸造完美的 AI 提示词。', badgeLocal:'100% 本地', badgeCost:'API 成本 $0', deviceDetecting:'检测中…', inputLabel:'你的意图', sampleBtn:'插入示例', inputPlaceholder:'例如：黄昏 · 海边 · 猫 · 电影感 · 孤独', modeLabel:'铸造模式', modeBoth:'两者', modeImage:'图像', modeText:'文本', outLangLabel:'输出提示词语言', imgEnNote:'为保证兼容性，图像提示词始终以英文铸造。', modelLabel:'本地 LLM 模型', modelNote:'首次运行缓存到浏览器，之后可离线使用。', forgeBtn:'铸造提示词', privacyNote:'你的输入绝不离开此设备。', statusLabel:'AI 意图预测状态', liveLabel:'推理实时视图', savedTotal:'本设备累计节省成本', forgeCount:'铸造次数', imgCardTitle:'图像生成提示词', imgCardSub:'用于 Midjourney / Stable Diffusion（英文）', copyBtn:'复制', negTitle:'反向提示词', emptyOut:'— 尚未铸造 —', saved:'节省', textCardTitle:'文本生成提示词', textCardSub:'用于 ChatGPT / Claude — 结构化提示词', sysCardTitle:'系统设定提示词', sysCardSub:'三大理念 — 本地优先 · 数据主权 · 零成本', footerTag:'无外部通信 / 零运营成本 / 零数据泄露', downloading:'正在下载模型…', stLoading:'正在启动本地 LLM…', stPredicting:'正在预测意图…', stForgingImg:'正在铸造图像提示词…', stForgingText:'正在铸造文本提示词…', stDone:'铸造完成 ✓', stReady:'引擎就绪', stError:'发生错误', copied:'已复制', needInput:'请先输入一些词语或要点。' },

  ko: { subtitle:'몇 개의 단어로 완벽한 AI 프롬프트를 주조하세요.', badgeLocal:'100% 로컬', badgeCost:'API 비용 $0', deviceDetecting:'감지 중…', inputLabel:'당신의 의도', sampleBtn:'예시 넣기', inputPlaceholder:'예: 황혼 · 해변 · 고양이 · 영화적 · 고독', modeLabel:'주조 모드', modeBoth:'둘 다', modeImage:'이미지', modeText:'텍스트', outLangLabel:'출력 프롬프트 언어', imgEnNote:'호환성을 위해 이미지 프롬프트는 항상 영어로 주조됩니다.', modelLabel:'로컬 LLM 모델', modelNote:'첫 실행 시 브라우저에 캐시. 이후 오프라인 작동.', forgeBtn:'프롬프트 주조', privacyNote:'입력은 이 기기를 절대 떠나지 않습니다.', statusLabel:'AI 의도 예측 상태', liveLabel:'추론 실시간 보기', savedTotal:'이 기기의 누적 절감 비용', forgeCount:'주조 횟수', imgCardTitle:'이미지 생성 프롬프트', imgCardSub:'Midjourney / Stable Diffusion 용 (영어)', copyBtn:'복사', negTitle:'네거티브 프롬프트', emptyOut:'— 아직 주조되지 않음 —', saved:'절감', textCardTitle:'텍스트 생성 프롬프트', textCardSub:'ChatGPT / Claude 용 — 구조화 프롬프트', sysCardTitle:'시스템 설정 프롬프트', sysCardSub:'세 가지 철학 — 로컬 우선 · 데이터 주권 · 비용 제로', footerTag:'외부 통신 없음 / 운영비 0원 / 정보 유출 0%', downloading:'모델 다운로드 중…', stLoading:'로컬 LLM 시작 중…', stPredicting:'의도 예측 중…', stForgingImg:'이미지 프롬프트 주조 중…', stForgingText:'텍스트 프롬프트 주조 중…', stDone:'주조 완료 ✓', stReady:'엔진 준비 완료', stError:'오류가 발생했습니다', copied:'복사했습니다', needInput:'먼저 단어나 요점을 입력하세요.' },

  es: { subtitle:'Forja prompts de IA perfectos a partir de unas palabras.', badgeLocal:'100% Local', badgeCost:'Costo API $0', deviceDetecting:'Detectando…', inputLabel:'Tu intención', sampleBtn:'Insertar ejemplo', inputPlaceholder:'ej.: atardecer · costa · gato · cinematográfico · soledad', modeLabel:'Modo de forja', modeBoth:'Ambos', modeImage:'Imagen', modeText:'Texto', outLangLabel:'Idioma del prompt de salida', imgEnNote:'Los prompts de imagen se forjan siempre en inglés por compatibilidad.', modelLabel:'Modelo LLM local', modelNote:'Se almacena en tu navegador la primera vez. Luego funciona sin conexión.', forgeBtn:'Forjar prompts', privacyNote:'Tu entrada nunca sale de este dispositivo.', statusLabel:'Predicción de intención IA', liveLabel:'Vista en vivo de inferencia', savedTotal:'Costo total ahorrado en este dispositivo', forgeCount:'Forjas', imgCardTitle:'Prompt de generación de imagen', imgCardSub:'Para Midjourney / Stable Diffusion (inglés)', copyBtn:'Copiar', negTitle:'Prompt negativo', emptyOut:'— aún no forjado —', saved:'Ahorro', textCardTitle:'Prompt de generación de texto', textCardSub:'Para ChatGPT / Claude — prompt estructurado', sysCardTitle:'Prompt de configuración del sistema', sysCardSub:'3 filosofías — local primero, soberanía de datos, costo cero', footerTag:'Sin llamadas externas / $0 de operación / 0% de fugas', downloading:'Descargando modelo…', stLoading:'Iniciando LLM local…', stPredicting:'Prediciendo intención…', stForgingImg:'Forjando prompt de imagen…', stForgingText:'Forjando prompt de texto…', stDone:'Forja completa ✓', stReady:'Motor listo', stError:'Ocurrió un error', copied:'Copiado al portapapeles', needInput:'Primero introduce algunas palabras o viñetas.' },

  fr: { subtitle:'Forgez des prompts IA parfaits à partir de quelques mots.', badgeLocal:'100% Local', badgeCost:'Coût API 0 $', deviceDetecting:'Détection…', inputLabel:'Votre intention', sampleBtn:'Insérer un exemple', inputPlaceholder:'ex. : crépuscule · bord de mer · chat · cinématique · solitude', modeLabel:'Mode de forge', modeBoth:'Les deux', modeImage:'Image', modeText:'Texte', outLangLabel:'Langue du prompt de sortie', imgEnNote:'Les prompts d’image sont toujours forgés en anglais pour la compatibilité.', modelLabel:'Modèle LLM local', modelNote:'Mis en cache dans votre navigateur au premier lancement. Fonctionne hors ligne ensuite.', forgeBtn:'Forger les prompts', privacyNote:'Votre saisie ne quitte jamais cet appareil.', statusLabel:'Prédiction d’intention IA', liveLabel:'Vue en direct de l’inférence', savedTotal:'Coût total économisé sur cet appareil', forgeCount:'Forges', imgCardTitle:'Prompt de génération d’image', imgCardSub:'Pour Midjourney / Stable Diffusion (anglais)', copyBtn:'Copier', negTitle:'Prompt négatif', emptyOut:'— pas encore forgé —', saved:'Économie', textCardTitle:'Prompt de génération de texte', textCardSub:'Pour ChatGPT / Claude — prompt structuré', sysCardTitle:'Prompt de configuration système', sysCardSub:'3 philosophies — local d’abord, souveraineté des données, coût zéro', footerTag:'Aucun appel externe / 0 $ d’exploitation / 0% de fuite', downloading:'Téléchargement du modèle…', stLoading:'Démarrage du LLM local…', stPredicting:'Prédiction de l’intention…', stForgingImg:'Forge du prompt d’image…', stForgingText:'Forge du prompt de texte…', stDone:'Forge terminée ✓', stReady:'Moteur prêt', stError:'Une erreur est survenue', copied:'Copié dans le presse-papiers', needInput:'Saisissez d’abord quelques mots ou puces.' },

  de: { subtitle:'Schmiede perfekte KI-Prompts aus wenigen Wörtern.', badgeLocal:'100% Lokal', badgeCost:'API-Kosten 0 $', deviceDetecting:'Erkenne…', inputLabel:'Deine Absicht', sampleBtn:'Beispiel einfügen', inputPlaceholder:'z. B.: Dämmerung · Meeresküste · Katze · filmisch · Einsamkeit', modeLabel:'Schmiede-Modus', modeBoth:'Beides', modeImage:'Bild', modeText:'Text', outLangLabel:'Sprache des Ausgabe-Prompts', imgEnNote:'Bild-Prompts werden aus Kompatibilitätsgründen stets auf Englisch geschmiedet.', modelLabel:'Lokales LLM-Modell', modelNote:'Beim ersten Start im Browser zwischengespeichert. Danach offline nutzbar.', forgeBtn:'Prompts schmieden', privacyNote:'Deine Eingabe verlässt dieses Gerät nie.', statusLabel:'KI-Absichtsvorhersage', liveLabel:'Inferenz-Live-Ansicht', savedTotal:'Gesamt gesparte Kosten auf diesem Gerät', forgeCount:'Schmiedungen', imgCardTitle:'Bildgenerierungs-Prompt', imgCardSub:'Für Midjourney / Stable Diffusion (Englisch)', copyBtn:'Kopieren', negTitle:'Negativ-Prompt', emptyOut:'— noch nicht geschmiedet —', saved:'Gespart', textCardTitle:'Textgenerierungs-Prompt', textCardSub:'Für ChatGPT / Claude — strukturierter Prompt', sysCardTitle:'System-Setup-Prompt', sysCardSub:'3 Philosophien — lokal zuerst, Datensouveränität, Null Kosten', footerTag:'Keine externen Aufrufe / 0 $ Betrieb / 0% Datenabfluss', downloading:'Modell wird heruntergeladen…', stLoading:'Lokales LLM wird gestartet…', stPredicting:'Absicht wird vorhergesagt…', stForgingImg:'Bild-Prompt wird geschmiedet…', stForgingText:'Text-Prompt wird geschmiedet…', stDone:'Schmiedung abgeschlossen ✓', stReady:'Engine bereit', stError:'Ein Fehler ist aufgetreten', copied:'In die Zwischenablage kopiert', needInput:'Gib zuerst einige Wörter oder Stichpunkte ein.' },

  ar: { subtitle:'اصنع موجهات ذكاء اصطناعي مثالية من بضع كلمات.', badgeLocal:'محلي 100%', badgeCost:'تكلفة API 0$', deviceDetecting:'جارٍ الكشف…', inputLabel:'نيتك', sampleBtn:'إدراج مثال', inputPlaceholder:'مثال: الغسق · الشاطئ · قطة · سينمائي · وحدة', modeLabel:'وضع الصياغة', modeBoth:'كلاهما', modeImage:'صورة', modeText:'نص', outLangLabel:'لغة الموجه الناتج', imgEnNote:'تُصاغ موجهات الصور دائمًا بالإنجليزية للتوافق.', modelLabel:'نموذج LLM المحلي', modelNote:'يُخزَّن في متصفحك أول مرة، ثم يعمل دون اتصال.', forgeBtn:'صياغة الموجهات', privacyNote:'لا تغادر مدخلاتك هذا الجهاز أبدًا.', statusLabel:'حالة توقّع النية بالذكاء الاصطناعي', liveLabel:'عرض الاستدلال المباشر', savedTotal:'إجمالي التكلفة الموفّرة على هذا الجهاز', forgeCount:'مرات الصياغة', imgCardTitle:'موجه توليد الصور', imgCardSub:'لـ Midjourney / Stable Diffusion (بالإنجليزية)', copyBtn:'نسخ', negTitle:'الموجه السلبي', emptyOut:'— لم تتم الصياغة بعد —', saved:'وُفّر', textCardTitle:'موجه توليد النص', textCardSub:'لـ ChatGPT / Claude — موجه منظَّم', sysCardTitle:'موجه إعداد النظام', sysCardSub:'ثلاث فلسفات — المحلية أولًا · سيادة البيانات · صفر تكلفة', footerTag:'لا اتصالات خارجية / تشغيل بـ 0$ / تسرّب بيانات 0%', downloading:'جارٍ تنزيل النموذج…', stLoading:'جارٍ تشغيل LLM المحلي…', stPredicting:'جارٍ توقّع النية…', stForgingImg:'جارٍ صياغة موجه الصورة…', stForgingText:'جارٍ صياغة موجه النص…', stDone:'اكتملت الصياغة ✓', stReady:'المحرك جاهز', stError:'حدث خطأ', copied:'تم النسخ', needInput:'أدخل بعض الكلمات أو النقاط أولًا.' },

  hi: { subtitle:'कुछ शब्दों से बेहतरीन AI प्रॉम्प्ट गढ़ें।', badgeLocal:'100% लोकल', badgeCost:'API लागत $0', deviceDetecting:'पहचान हो रही है…', inputLabel:'आपका इरादा', sampleBtn:'उदाहरण डालें', inputPlaceholder:'जैसे: सांझ · समुद्र किनारा · बिल्ली · सिनेमाई · एकांत', modeLabel:'गढ़ने का मोड', modeBoth:'दोनों', modeImage:'छवि', modeText:'टेक्स्ट', outLangLabel:'आउटपुट प्रॉम्प्ट की भाषा', imgEnNote:'संगतता के लिए छवि प्रॉम्प्ट हमेशा अंग्रेज़ी में गढ़े जाते हैं।', modelLabel:'लोकल LLM मॉडल', modelNote:'पहली बार ब्राउज़र में कैश होता है, फिर ऑफ़लाइन चलता है।', forgeBtn:'प्रॉम्प्ट गढ़ें', privacyNote:'आपका इनपुट यह डिवाइस कभी नहीं छोड़ता।', statusLabel:'AI इरादा पूर्वानुमान स्थिति', liveLabel:'इन्फरेंस लाइव दृश्य', savedTotal:'इस डिवाइस पर कुल बचत', forgeCount:'गढ़ाई', imgCardTitle:'छवि जनरेशन प्रॉम्प्ट', imgCardSub:'Midjourney / Stable Diffusion के लिए (अंग्रेज़ी)', copyBtn:'कॉपी', negTitle:'नेगेटिव प्रॉम्प्ट', emptyOut:'— अभी तक नहीं गढ़ा गया —', saved:'बचत', textCardTitle:'टेक्स्ट जनरेशन प्रॉम्प्ट', textCardSub:'ChatGPT / Claude के लिए — संरचित प्रॉम्प्ट', sysCardTitle:'सिस्टम सेटअप प्रॉम्प्ट', sysCardSub:'3 दर्शन — लोकल-फर्स्ट · डेटा संप्रभुता · शून्य लागत', footerTag:'कोई बाहरी कॉल नहीं / $0 संचालन / 0% डेटा रिसाव', downloading:'मॉडल डाउनलोड हो रहा है…', stLoading:'लोकल LLM शुरू हो रहा है…', stPredicting:'इरादे का पूर्वानुमान…', stForgingImg:'छवि प्रॉम्प्ट गढ़ी जा रही है…', stForgingText:'टेक्स्ट प्रॉम्प्ट गढ़ी जा रही है…', stDone:'गढ़ाई पूर्ण ✓', stReady:'इंजन तैयार', stError:'एक त्रुटि हुई', copied:'क्लिपबोर्ड पर कॉपी हुआ', needInput:'पहले कुछ शब्द या बिंदु दर्ज करें।' },
};

const SAMPLES = {
  ja:'夕暮れ\n海辺の古い灯台\n一匹の三毛猫\n映画的でノスタルジック\n静かな孤独感',
  en:'dusk\nan old lighthouse by the sea\na single calico cat\ncinematic and nostalgic\nquiet solitude',
  zh:'黄昏\n海边的老灯塔\n一只三花猫\n电影感、怀旧\n静谧的孤独',
  ko:'황혼\n바닷가의 오래된 등대\n한 마리의 삼색 고양이\n영화적이고 향수 어린\n고요한 고독',
  es:'atardecer\nun viejo faro junto al mar\nun gato calicó solitario\ncinematográfico y nostálgico\nsoledad serena',
  fr:'crépuscule\nun vieux phare au bord de la mer\nun chat calico solitaire\ncinématique et nostalgique\nsolitude paisible',
  de:'Dämmerung\nein alter Leuchtturm am Meer\neine einzelne Glückskatze\nfilmisch und nostalgisch\nstille Einsamkeit',
  ar:'الغسق\nمنارة قديمة بجانب البحر\nقطة ثلاثية الألوان وحيدة\nسينمائي وحنيني\nوحدة هادئة',
  hi:'सांझ\nसमुद्र किनारे एक पुराना लाइटहाउस\nएक अकेली तिरंगी बिल्ली\nसिनेमाई और पुरानी यादों भरा\nशांत एकांत',
};

const t = (k) => (I18N[state.uiLang] && I18N[state.uiLang][k]) || I18N.en[k] || k;

/* Localized templates for the deterministic, always-high-quality text prompt.
 * Used directly when the tiny LLM's output is incoherent, so the result is
 * never gibberish in any language. {topic}=keywords, {lang}=target language. */
const TPL = {
  ja:{roleH:'役割',contextH:'背景',taskH:'タスク',formatH:'出力フォーマット',constraintsH:'制約',
    roleBody:tp=>`あなたは「${tp}」に関する世界トップクラスの専門家です。`,
    contextBody:tp=>`ユーザーは次のテーマに取り組んでいます: ${tp}。`,
    taskBody:tp=>`ユーザーの真の目的を読み取り、上記テーマについて完成度の高い成果物を提供してください。明示されていない潜在的なニーズも先回りして満たすこと。`,
    formatBody:ln=>`- ${ln}で、見出し・短い段落・必要に応じた箇条書きを用いて構造的に回答する。`,
    c1:'- 具体的かつ実行可能に。一般論や埋め草は省く。',c2:'- 前提は明示し、本当に必要なときだけ質問する。'},
  en:{roleH:'Role',contextH:'Context',taskH:'Task',formatH:'Output Format',constraintsH:'Constraints',
    roleBody:tp=>`You are a world-class expert in ${tp}.`,
    contextBody:tp=>`The user is working on the following theme: ${tp}.`,
    taskBody:tp=>`Understand the user's true underlying goal and deliver a complete, high-quality result for the theme above. Anticipate needs they did not state explicitly.`,
    formatBody:ln=>`- Respond in ${ln} with clear headings, short paragraphs, and bullet points where helpful.`,
    c1:'- Be concrete and actionable; cut filler and generic advice.',c2:'- State any assumptions; ask a question only when truly blocked.'},
  zh:{roleH:'角色',contextH:'背景',taskH:'任务',formatH:'输出格式',constraintsH:'约束',
    roleBody:tp=>`你是「${tp}」领域的世界级专家。`,
    contextBody:tp=>`用户正在处理以下主题：${tp}。`,
    taskBody:tp=>`理解用户的真实目标，针对上述主题交付完整、高质量的成果，并预见用户未明确说出的需求。`,
    formatBody:ln=>`- 用${ln}回答，使用清晰的标题、简短段落，并在合适处使用要点列表。`,
    c1:'- 具体且可执行，去除空话与泛泛建议。',c2:'- 明确说明假设；仅在确实受阻时才提问。'},
  ko:{roleH:'역할',contextH:'배경',taskH:'과제',formatH:'출력 형식',constraintsH:'제약',
    roleBody:tp=>`당신은 「${tp}」 분야의 세계 최고 수준 전문가입니다.`,
    contextBody:tp=>`사용자는 다음 주제를 다루고 있습니다: ${tp}.`,
    taskBody:tp=>`사용자의 진짜 목표를 파악하고 위 주제에 대해 완성도 높은 결과물을 제공하세요. 명시되지 않은 필요까지 미리 충족하세요.`,
    formatBody:ln=>`- ${ln}로, 명확한 제목·짧은 단락·필요 시 글머리 기호를 사용해 구조적으로 답하세요.`,
    c1:'- 구체적이고 실행 가능하게. 군더더기와 일반론은 제거.',c2:'- 가정은 명시하고, 정말 막혔을 때만 질문하세요.'},
  es:{roleH:'Rol',contextH:'Contexto',taskH:'Tarea',formatH:'Formato de salida',constraintsH:'Restricciones',
    roleBody:tp=>`Eres un experto de talla mundial en ${tp}.`,
    contextBody:tp=>`El usuario trabaja en el siguiente tema: ${tp}.`,
    taskBody:tp=>`Comprende el objetivo real del usuario y entrega un resultado completo y de alta calidad sobre el tema anterior. Anticipa necesidades que no expresó explícitamente.`,
    formatBody:ln=>`- Responde en ${ln} con títulos claros, párrafos breves y viñetas cuando sea útil.`,
    c1:'- Sé concreto y accionable; elimina el relleno y los consejos genéricos.',c2:'- Declara cualquier suposición; pregunta solo si estás realmente bloqueado.'},
  fr:{roleH:'Rôle',contextH:'Contexte',taskH:'Tâche',formatH:'Format de sortie',constraintsH:'Contraintes',
    roleBody:tp=>`Vous êtes un expert de classe mondiale en ${tp}.`,
    contextBody:tp=>`L'utilisateur travaille sur le thème suivant : ${tp}.`,
    taskBody:tp=>`Comprenez l'objectif réel de l'utilisateur et livrez un résultat complet et de haute qualité sur le thème ci-dessus. Anticipez les besoins non exprimés.`,
    formatBody:ln=>`- Répondez en ${ln} avec des titres clairs, des paragraphes courts et des puces si utile.`,
    c1:'- Soyez concret et actionnable ; supprimez le remplissage et les conseils génériques.',c2:'- Énoncez vos hypothèses ; ne posez une question que si vous êtes vraiment bloqué.'},
  de:{roleH:'Rolle',contextH:'Kontext',taskH:'Aufgabe',formatH:'Ausgabeformat',constraintsH:'Einschränkungen',
    roleBody:tp=>`Du bist ein erstklassiger Experte für ${tp}.`,
    contextBody:tp=>`Der Nutzer arbeitet am folgenden Thema: ${tp}.`,
    taskBody:tp=>`Verstehe das eigentliche Ziel des Nutzers und liefere ein vollständiges, hochwertiges Ergebnis zum obigen Thema. Antizipiere nicht ausgesprochene Bedürfnisse.`,
    formatBody:ln=>`- Antworte auf ${ln} mit klaren Überschriften, kurzen Absätzen und Aufzählungen, wo sinnvoll.`,
    c1:'- Sei konkret und umsetzbar; lass Füllwörter und generische Ratschläge weg.',c2:'- Nenne deine Annahmen; frage nur nach, wenn du wirklich blockiert bist.'},
  ar:{roleH:'الدور',contextH:'السياق',taskH:'المهمة',formatH:'صيغة الإخراج',constraintsH:'القيود',
    roleBody:tp=>`أنت خبير عالمي المستوى في ${tp}.`,
    contextBody:tp=>`يعمل المستخدم على الموضوع التالي: ${tp}.`,
    taskBody:tp=>`افهم الهدف الحقيقي للمستخدم وقدّم نتيجة كاملة وعالية الجودة حول الموضوع أعلاه، واستبق الاحتياجات غير المعلنة.`,
    formatBody:ln=>`- أجب بـ${ln} باستخدام عناوين واضحة وفقرات قصيرة ونقاط عند الحاجة.`,
    c1:'- كن محددًا وقابلًا للتنفيذ؛ احذف الحشو والنصائح العامة.',c2:'- وضّح أي افتراضات؛ ولا تسأل إلا عند التوقف فعلًا.'},
  hi:{roleH:'भूमिका',contextH:'संदर्भ',taskH:'कार्य',formatH:'आउटपुट प्रारूप',constraintsH:'बाधाएँ',
    roleBody:tp=>`आप ${tp} में विश्व-स्तरीय विशेषज्ञ हैं।`,
    contextBody:tp=>`उपयोगकर्ता निम्न विषय पर काम कर रहा है: ${tp}।`,
    taskBody:tp=>`उपयोगकर्ता का वास्तविक लक्ष्य समझें और उपरोक्त विषय पर पूर्ण, उच्च-गुणवत्ता वाला परिणाम दें। अनकही ज़रूरतों का भी पूर्वानुमान करें।`,
    formatBody:ln=>`- ${ln} में स्पष्ट शीर्षकों, छोटे अनुच्छेदों और जहाँ उपयोगी हो वहाँ बुलेट के साथ उत्तर दें।`,
    c1:'- ठोस और क्रियान्वयन-योग्य रहें; भराव और सामान्य सलाह हटाएँ।',c2:'- अपनी धारणाएँ बताएँ; केवल वास्तव में अटकने पर ही प्रश्न पूछें।'},
};

const splitKw = (kw) => kw.split(/[\n,，、・·;；|]+/).map(s => s.trim()).filter(Boolean);

/* Reject incoherent / repetitive LLM output (the failure mode of tiny models),
 * in a language-agnostic way, so we can fall back to the templates. */
function isCoherent(s, keywords) {
  if (!s) return false;
  const text = s.trim();
  if (text.replace(/\s/g, '').length < 14) return false;

  // Run-on gibberish: an absurdly long unbroken token (e.g. "PERBERPETERBPPER…").
  if (/[A-Za-zÀ-ɏ]{28,}/.test(text)) return false;

  // Shouting gibberish: latin text that is mostly uppercase.
  const latin = text.match(/[A-Za-z]/g) || [];
  if (latin.length > 16) {
    const upper = text.match(/[A-Z]/g) || [];
    if (upper.length / latin.length > 0.5) return false;
  }

  // Segment-level repetition (catches "Calo, Calo, Calo" / "Map: Map: Map").
  const segs = text.split(/[,，、;；:：\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  if (segs.length >= 5 && new Set(segs).size / segs.length < 0.6) return false;

  // Word-level repetition for space-separated scripts (latin etc.).
  const words = text.toLowerCase().match(/[a-zà-ɏ]+/g) || [];
  if (words.length >= 8) {
    if (new Set(words).size / words.length < 0.5) return false;
    const freq = {}; let max = 0;
    for (const w of words) { freq[w] = (freq[w] || 0) + 1; if (freq[w] > max) max = freq[w]; }
    if (max / words.length > 0.22) return false;
  }

  // Character-level repetition for CJK scripts (catches "型型型性性的性的的").
  const cjk = text.match(/[぀-ヿ㐀-鿿가-힯]/g) || [];
  if (cjk.length >= 10) {
    if (new Set(cjk).size / cjk.length < 0.5) return false;
    const freq = {}; let max = 0;
    for (const c of cjk) { freq[c] = (freq[c] || 0) + 1; if (freq[c] > max) max = freq[c]; }
    if (max / cjk.length > 0.16) return false;
  }

  // Relevance: when the output and the input share the latin/digit alphabet, a
  // genuine result should reference the subject. Zero overlap = off-topic noise.
  if (keywords) {
    const kw = new Set((keywords.toLowerCase().match(/[a-z0-9]{3,}/g) || []));
    const out = new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) || []));
    if (kw.size && out.size) {
      let hit = false;
      for (const w of kw) if (out.has(w)) { hit = true; break; }
      if (!hit) return false;
    }
  }
  return true;
}

function templateImage(kw) {
  const subject = splitKw(kw).join(', ') || 'a striking subject';
  return `${subject}, cinematic composition, rule-of-thirds framing, shot on 85mm lens, f/1.8 shallow depth of field, dramatic volumetric lighting, golden-hour rim light, rich cinematic color grading, atmospheric depth, ${QUALITY_TAGS}`;
}

function templateText(kw, langCode, langName) {
  const L = TPL[langCode] || TPL.en;
  const topic = splitKw(kw).slice(0, 6).join(', ') || kw;
  return [
    `# ${L.roleH}`, L.roleBody(topic), '',
    `# ${L.contextH}`, L.contextBody(topic), '',
    `# ${L.taskH}`, L.taskBody(topic), '',
    `# ${L.formatH}`, L.formatBody(langName), '',
    `# ${L.constraintsH}`, L.c1, L.c2,
  ].join('\n');
}

/* -----------------------------------------------------------------------------
 * 3. STATE
 * -------------------------------------------------------------------------- */
const state = {
  uiLang: 'ja',
  outLang: 'ja',
  mode: 'both',
  modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  device: null,
  busy: false,
  savedTotal: 0,
  forges: 0,
};
const COST_PER_FORGE = 0.032; // playful cloud-API cost estimate (USD) avoided per forge

/* -----------------------------------------------------------------------------
 * 4. DOM helpers
 * -------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const els = {};
['uiLang','outLang','modelSelect','intentInput','forgeBtn','sampleBtn','modeGroup',
 'deviceBadge','engineDot','statusText','progressWrap','progressBar','progressPct',
 'progressLabel','progressFile','liveStream','savedTotal','forgeCount',
 'imgPromptOut','negPromptOut','textPromptOut','sysPromptOut','toast','toastMsg'
].forEach(id => els[id] = $(id));

function applyI18n() {
  document.documentElement.lang = state.uiLang;
  document.documentElement.dir = RTL.has(state.uiLang) ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
}

function setStatus(key, { spinning = false, ok = false, err = false } = {}) {
  els.statusText.textContent = t(key);
  const dot = els.engineDot;
  dot.className = 'h-2.5 w-2.5 rounded-full ' +
    (err ? 'bg-ember-500' : ok ? 'bg-mint-400' : spinning ? 'bg-forge-400 pulse-dot' : 'bg-slate-600');
}

function setDeviceBadge(device) {
  const dot = els.deviceBadge.querySelector('span');
  const label = els.deviceBadge.querySelectorAll('span')[1];
  if (device === 'webgpu') { dot.className = 'h-1.5 w-1.5 rounded-full bg-mint-400'; label.textContent = '⚡ WebGPU'; }
  else if (device === 'wasm') { dot.className = 'h-1.5 w-1.5 rounded-full bg-ember-400'; label.textContent = '🧩 WASM'; }
  else { dot.className = 'h-1.5 w-1.5 rounded-full bg-slate-500'; label.textContent = t('deviceDetecting'); }
}

function showProgress(show) { els.progressWrap.classList.toggle('hidden', !show); }
function setProgress(pct, file) {
  els.progressBar.style.width = `${pct}%`;
  els.progressPct.textContent = `${pct}%`;
  if (file) els.progressFile.textContent = file;
}

function toast(msg) {
  els.toastMsg.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => els.toast.classList.add('hidden'), 1600);
}

/* -----------------------------------------------------------------------------
 * 5. Worker event handlers
 * -------------------------------------------------------------------------- */
function onDeviceDetected(device) { state.device = device; setDeviceBadge(device); }

const dlProgress = {}; // file -> {loaded,total}
function onProgress(p) {
  if (p.status === 'progress' && p.file) {
    dlProgress[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
    let loaded = 0, total = 0;
    for (const f in dlProgress) { loaded += dlProgress[f].loaded; total += dlProgress[f].total; }
    const pct = total ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
    showProgress(true);
    setProgress(pct, p.file.split('/').pop());
  } else if (p.status === 'done' && p.file) {
    // keep bar; final flips to 100 on ready
  }
}

function onModelReady(device) {
  setProgress(100, '');
  setTimeout(() => showProgress(false), 600);
  setDeviceBadge(device);
}

/* -----------------------------------------------------------------------------
 * 6. PROMPT FORGING
 *    The model predicts intent; deterministic enhancers guarantee a polished,
 *    well-structured result even when a tiny model is imperfect.
 * -------------------------------------------------------------------------- */
const QUALITY_TAGS = '8k, ultra-detailed, hyper-realistic, sharp focus, intricate detail, masterpiece';
const DEFAULT_NEGATIVE = 'low quality, blurry, lowres, deformed, disfigured, bad anatomy, extra limbs, extra fingers, watermark, signature, text, jpeg artifacts, oversaturated, cropped, out of frame, ugly, duplicate';

function imageSystemPrompt() {
  return [
    'You are a world-class prompt engineer for AI image generation (Midjourney / Stable Diffusion).',
    'The user gives you loose keywords or bullet points. Infer the single most compelling, coherent scene they most likely want to create.',
    'Produce ONE richly detailed prompt in ENGLISH that specifies: subject, setting/environment, composition & camera angle, lens & camera settings (e.g. 85mm, f/1.8), lighting, color palette, art style, and mood.',
    'Then produce a concise negative prompt of things to avoid.',
    'Respond in EXACTLY this format and nothing else:',
    'PROMPT: <the detailed english prompt>',
    'NEGATIVE: <comma-separated negative terms>',
  ].join('\n');
}

function textSystemPrompt(langName) {
  return [
    `You are a world-class LLM prompt engineer. Write the entire response in ${langName}.`,
    'The user gives loose keywords or bullet points. Infer their true underlying goal and craft a single, reusable, production-grade prompt for an assistant like ChatGPT or Claude.',
    'Structure it with clear labeled sections in this order: Role/Persona, Context, Task, Output Format, Constraints.',
    'Be specific and actionable. Output only the finished prompt — no preamble, no explanation.',
  ].join('\n');
}

// Parse "PROMPT:/NEGATIVE:" blocks robustly, with fallbacks.
function parseImage(raw, keywords) {
  let prompt = '', negative = '';
  const pm = raw.match(/PROMPT\s*[:：]\s*([\s\S]*?)(?:NEGATIVE\s*[:：]|$)/i);
  const nm = raw.match(/NEGATIVE\s*[:：]\s*([\s\S]*)$/i);
  if (pm) prompt = pm[1].trim();
  if (nm) negative = nm[1].trim();
  if (!prompt) prompt = raw.replace(/NEGATIVE[\s\S]*$/i, '').replace(/^PROMPT\s*[:：]?/i, '').trim();
  if (!prompt) prompt = keywords; // ultimate fallback

  // Guarantee quality boosters are present.
  if (!/8k|hyper-?realistic|masterpiece|ultra-detailed/i.test(prompt)) {
    prompt = `${prompt.replace(/\.?\s*$/, '')}, ${QUALITY_TAGS}`;
  }
  if (!negative) negative = DEFAULT_NEGATIVE;
  return { prompt: prompt.trim(), negative: negative.replace(/\s+/g, ' ').trim() };
}

// Deterministic localized system/philosophy prompt — always high quality.
function forgeSystemPrompt(keywords, langName) {
  const topic = keywords.split(/\n|,|·|・/).map(s => s.trim()).filter(Boolean).slice(0, 6).join(', ') || 'the user\'s project';
  return [
    `# SYSTEM CONFIGURATION — forged by PromptFoundry Local`,
    `# Respond in ${langName}.`,
    ``,
    `You are an expert assistant operating under three non-negotiable philosophies:`,
    `  1. LOCAL-FIRST — prefer solutions that run on the user's own device; never require an external paid service when a local path exists.`,
    `  2. DATA SOVEREIGNTY — treat all user input as private. Never imply, suggest, or require sending it to a third party.`,
    `  3. ZERO WASTE — strip needless cost and complexity; deliver the leanest answer that fully solves the problem.`,
    ``,
    `Domain / focus for this session: ${topic}.`,
    ``,
    `Behaviour:`,
    `- Ask a clarifying question only when truly blocked; otherwise act on the most reasonable interpretation.`,
    `- Be concrete and actionable. Prefer examples over abstractions.`,
    `- State assumptions explicitly and keep responses tight.`,
  ].join('\n');
}

/* -----------------------------------------------------------------------------
 * 7. ORCHESTRATION
 * -------------------------------------------------------------------------- */
function streamTo(elKey) {
  return (token) => {
    const el = els[elKey];
    if (el === els.liveStream) { el.textContent += token; el.scrollTop = el.scrollHeight; }
  };
}

async function forge() {
  if (state.busy) return;
  const keywords = els.intentInput.value.trim();
  if (!keywords) { toast(t('needInput')); els.intentInput.focus(); return; }

  state.busy = true;
  els.forgeBtn.disabled = true;
  els.liveStream.textContent = '';
  const outMeta = LANGS.find(l => l.code === state.outLang) || {};
  const langName = outMeta.name || 'English';   // English name → steers the LLM
  const langLabel = outMeta.label || langName;  // native label → used in templates

  // Reset relevant outputs
  if (state.mode !== 'text') { els.imgPromptOut.textContent = ''; els.negPromptOut.textContent = ''; }
  if (state.mode !== 'image') els.textPromptOut.textContent = '';

  try {
    setStatus('stLoading', { spinning: true });

    // ---- IMAGE ----
    if (state.mode === 'both' || state.mode === 'image') {
      setStatus('stForgingImg', { spinning: true });
      els.liveStream.textContent = '🎨 ' + t('stForgingImg') + '\n\n';
      const raw = await runLLM({
        system: imageSystemPrompt(),
        user: `Keywords / bullet points:\n${keywords}`,
        max_new_tokens: 300,
        onToken: streamTo('liveStream'),
      });
      const parsed = parseImage(raw, keywords);
      // Image prompts must be English-dominant AND coherent; otherwise the always-strong
      // deterministic template carries the result. Quality tags are guaranteed either way.
      const allLetters = (parsed.prompt.match(/\p{L}/gu) || []).length;
      const latinLetters = (parsed.prompt.match(/[a-z]/gi) || []).length;
      const englishEnough = allLetters > 0 && latinLetters / allLetters > 0.7;
      const finalImg = (englishEnough && isCoherent(parsed.prompt, keywords))
        ? parsed.prompt : templateImage(keywords);
      els.imgPromptOut.textContent = finalImg;
      els.negPromptOut.textContent = parsed.negative || DEFAULT_NEGATIVE;
      els.imgPromptOut.classList.add('fade-in');
    }

    // ---- TEXT ----
    if (state.mode === 'both' || state.mode === 'text') {
      setStatus('stForgingText', { spinning: true });
      els.liveStream.textContent += '\n\n💬 ' + t('stForgingText') + '\n\n';
      const raw = await runLLM({
        system: textSystemPrompt(langName),
        user: `Keywords / bullet points:\n${keywords}`,
        max_new_tokens: 420,
        onToken: streamTo('liveStream'),
      });
      els.textPromptOut.textContent = isCoherent(raw, keywords) ? raw.trim() : templateText(keywords, state.outLang, langLabel);
      els.textPromptOut.classList.add('fade-in');
    }

    // ---- SYSTEM (deterministic, instant) ----
    els.sysPromptOut.textContent = forgeSystemPrompt(keywords, langName);
    els.sysPromptOut.classList.add('fade-in');

    // ---- Savings ----
    state.forges += 1;
    state.savedTotal += COST_PER_FORGE;
    persist();
    renderSavings();

    setStatus('stDone', { ok: true });
  } catch (err) {
    console.error(err);
    setStatus('stError', { err: true });
    els.liveStream.textContent += `\n\n[error] ${err.message || err}`;
  } finally {
    state.busy = false;
    els.forgeBtn.disabled = false;
  }
}

/* -----------------------------------------------------------------------------
 * 8. Savings persistence
 * -------------------------------------------------------------------------- */
function persist() {
  try {
    localStorage.setItem('pfl_saved', String(state.savedTotal));
    localStorage.setItem('pfl_forges', String(state.forges));
  } catch (_) {}
}
function restore() {
  try {
    state.savedTotal = parseFloat(localStorage.getItem('pfl_saved')) || 0;
    state.forges = parseInt(localStorage.getItem('pfl_forges')) || 0;
    state.uiLang = localStorage.getItem('pfl_uiLang') || detectUiLang();
    state.outLang = localStorage.getItem('pfl_outLang') || state.uiLang;
  } catch (_) { state.uiLang = detectUiLang(); state.outLang = state.uiLang; }
}
function renderSavings() {
  els.savedTotal.textContent = `$${state.savedTotal.toFixed(2)}`;
  els.forgeCount.textContent = String(state.forges);
  document.querySelectorAll('.saved-amt').forEach(e => e.textContent = `$${COST_PER_FORGE.toFixed(2)}`);
}
function detectUiLang() {
  const n = (navigator.language || 'ja').slice(0, 2).toLowerCase();
  return LANGS.some(l => l.code === n) ? n : 'en';
}

/* -----------------------------------------------------------------------------
 * 9. UI wiring
 * -------------------------------------------------------------------------- */
function buildLangSelects() {
  const opts = LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
  els.uiLang.innerHTML = opts;
  els.outLang.innerHTML = opts;
  els.uiLang.value = state.uiLang;
  els.outLang.value = state.outLang;
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    const active = b.dataset.mode === mode;
    b.className = 'mode-btn rounded-lg py-2 border transition ' +
      (active ? 'bg-forge-500/15 border-forge-500/50 text-forge-300'
              : 'bg-ink-800 border-white/10 text-slate-400 hover:border-forge-500/30');
  });
  // Show/hide cards relevant to mode
  $('imageCard').classList.toggle('hidden', mode === 'text');
  $('textCard').classList.toggle('hidden', mode === 'image');
}

async function copyFrom(targetId) {
  const text = $(targetId).textContent;
  if (!text || text.startsWith('—')) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // Fallback for file:// where clipboard API may be blocked
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  toast(t('copied'));
}

function wire() {
  els.uiLang.addEventListener('change', () => {
    state.uiLang = els.uiLang.value;
    try { localStorage.setItem('pfl_uiLang', state.uiLang); } catch (_) {}
    applyI18n(); renderSavings(); setDeviceBadge(state.device);
    if (!state.busy) setStatus(state.device ? 'stReady' : 'statusIdle', { ok: !!state.device });
  });
  els.outLang.addEventListener('change', () => {
    state.outLang = els.outLang.value;
    try { localStorage.setItem('pfl_outLang', state.outLang); } catch (_) {}
  });
  els.modelSelect.addEventListener('change', () => { state.modelId = els.modelSelect.value; });

  els.modeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
  });

  els.sampleBtn.addEventListener('click', () => {
    els.intentInput.value = SAMPLES[state.uiLang] || SAMPLES.en;
    els.intentInput.focus();
  });

  els.forgeBtn.addEventListener('click', forge);
  els.intentInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') forge();
  });

  document.querySelectorAll('.copy-btn').forEach(b => {
    b.addEventListener('click', () => copyFrom(b.dataset.copy));
  });
}

/* -----------------------------------------------------------------------------
 * 10. INIT
 * -------------------------------------------------------------------------- */
function init() {
  restore();
  buildLangSelects();
  applyI18n();
  setMode(state.mode);
  setDeviceBadge(null);
  renderSavings();
  setStatus('statusIdle');
  wire();

  // Register the service worker so the app shell + library work fully offline.
  // Only over http(s) — service workers aren't allowed on the file:// protocol,
  // where the app still runs fine without it.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {/* offline shell is best-effort */});
    });
  }

  // Warm up: boot worker + start downloading/caching the model immediately so the
  // first forge is fast. Runs entirely off the main thread — UI stays responsive.
  bootWorker().postMessage({ type: 'preload', modelId: state.modelId });
}

document.addEventListener('DOMContentLoaded', init);
