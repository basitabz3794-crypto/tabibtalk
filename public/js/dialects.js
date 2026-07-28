/* ============================================================
   Tabib Talk — Arabic dialect packs
   ============================================================

   The app's built-in content is EGYPTIAN Arabic. This file layers other
   dialects on top of it: when a student picks Hejazi or Khaleeji, the app
   swaps in the Arabic + Franco from here and leaves everything else alone.

   ⚠️  REVIEW STATUS — READ BEFORE ENABLING FOR STUDENTS
   These translations are DRAFTS produced by an AI assistant, not by a native
   Hejazi/Khaleeji-speaking clinician. They are phrases students will say to
   real patients while taking a history, so each batch must be checked by a
   native speaker before it is switched on. Set `reviewed: true` on a batch
   only once a human has actually signed it off.

   HOW TO ADD / EDIT
   Entries are keyed by the ENGLISH text (normalised: lowercase, punctuation
   stripped) so a reviewer can read this file straight down. Every entry needs
   BOTH the Arabic script and the Franco (English-letter) spelling, because the
   app shows both. Anything with no entry here simply stays Egyptian — partial
   coverage is safe.

     "<english phrase>": { ar: "<arabic>", fr: "<franco>" }
   ============================================================ */

window.TT_DIALECT_PACK = {
  meta: {
    batch: 1,
    reviewed: false,               // ← flip to true only after a native speaker checks it
    covers: ['Communication & Ethics'],
    note: 'Draft batch 1 — greetings, introduction/permission, guiding & empathy.',
  },

  /* ---------------- Saudi — Hejazi ---------------- */
  hejazi: {
    // Greeting & Checking In
    'peace be upon you':            { ar: 'السلام عليكم',              fr: 'As-salamu 3alaykom' },
    'and upon you be peace':        { ar: 'وعليكم السلام',             fr: 'Wa 3alaykom as-salam' },
    'good morning good evening':    { ar: 'صباح الخير / مساء الخير',   fr: 'Sabah al-khair / Masa al-khair' },
    'good morning doctor':          { ar: 'صباح النور يا دكتور',       fr: 'Sabah an-noor ya doktor' },
    'how are you doing today':      { ar: 'كيفك اليوم؟ / كيف حالك؟',   fr: 'Kaifak al-yom? / Kaif halak?' },
    'praise be to god':             { ar: 'الحمد لله',                 fr: 'Al-hamdulillah' },

    // Introduction & Permission
    'my name is ahmad a student':   { ar: 'اسمي أحمد، طالب',           fr: 'Ismi Ahmad, talib' },
    'welcome':                      { ar: 'أهلاً وسهلاً',              fr: 'Ahlan wa sahlan' },
    'may i speak to you for a moment': { ar: 'ممكن أكلمك شوي؟',        fr: 'Mumkin akallimak shway?' },
    'go ahead':                     { ar: 'تفضل',                      fr: 'Tafaddal' },
    'may i ask you about your condition': { ar: 'ممكن أسألك عن حالتك؟', fr: 'Mumkin as\'alak 3an halatak?' },
    'yes sure':                     { ar: 'أيوه أكيد',                 fr: 'Aywa akeed' },
    'i will try not to take much of your time': { ar: 'ما راح أطوّل عليك إن شاء الله', fr: 'Ma rah atawwil 3alaik in sha Allah' },
    'take your time':               { ar: 'خذ راحتك',                  fr: 'Khudh rahtak' },

    // Guiding the Conversation & Empathy
    'if i exhaust you you can ask me to stop anytime': { ar: 'لو حسّيت إنك تعبت، قول لي نوقف', fr: 'Law hassait innak ti3ibt, gul li nwaggif' },
    'thank you doctor':             { ar: 'شكراً يا دكتور',            fr: 'Shukran ya doktor' },
    'can you concentrate with me please': { ar: 'ممكن تركّز معاي شوي؟', fr: 'Mumkin trakkiz ma3aay shway?' },
    'yes i am with you':            { ar: 'أيوه معاك',                 fr: 'Aywa ma3ak' },
    'can you speak a bit slowly sir': { ar: 'ممكن تتكلم على مهلك شوي؟', fr: 'Mumkin titkallam 3ala mahlak shway?' },
    'okay sorry':                   { ar: 'طيب، آسف',                  fr: 'Tayyib, asif' },
    'what did you say':             { ar: 'نعم؟ / وش قلت؟',            fr: 'Na3am? / Wesh gult?' },
    'i said i have pain':           { ar: 'أقول عندي ألم',             fr: 'Agool 3indi alam' },
    'may god heal your illness':    { ar: 'الله يشفيك',                fr: 'Allah yishfeek' },
    'amen':                         { ar: 'آمين',                      fr: 'Ameen' },
    'im sorry sir but i dont know': { ar: 'أنا آسف، بس ما أعرف',       fr: 'Ana asif, bass ma a3rif' },
    'no problem':                   { ar: 'ما فيه مشكلة',              fr: 'Ma feeh mushkila' },
    'god forbids':                  { ar: 'لا قدّر الله',              fr: 'La gaddar Allah' },
    'praise god':                   { ar: 'الحمد لله',                 fr: 'Al-hamdulillah' },
  },

  /* ---------------- Gulf — Khaleeji ---------------- */
  khaleeji: {
    // Greeting & Checking In
    'peace be upon you':            { ar: 'السلام عليكم',              fr: 'As-salamu 3alaykom' },
    'and upon you be peace':        { ar: 'وعليكم السلام',             fr: 'Wa 3alaykom as-salam' },
    'good morning good evening':    { ar: 'صباح الخير / مساء الخير',   fr: 'Sabah al-khair / Masa al-khair' },
    'good morning doctor':          { ar: 'صباح النور يا دكتور',       fr: 'Sabah an-noor ya doktor' },
    'how are you doing today':      { ar: 'شلونك اليوم؟',              fr: 'Shlonak al-yom?' },
    'praise be to god':             { ar: 'الحمد لله',                 fr: 'Al-hamdulillah' },

    // Introduction & Permission
    'my name is ahmad a student':   { ar: 'اسمي أحمد، طالب',           fr: 'Ismi Ahmad, talib' },
    'welcome':                      { ar: 'حيّاك الله',                fr: 'Hayyak Allah' },
    'may i speak to you for a moment': { ar: 'ممكن أكلمك شوي؟',        fr: 'Mumkin akallimik shway?' },
    'go ahead':                     { ar: 'تفضل',                      fr: 'Tfaddal' },
    'may i ask you about your condition': { ar: 'ممكن أسألك عن حالتك؟', fr: 'Mumkin as\'alik 3an halatik?' },
    'yes sure':                     { ar: 'إي أكيد',                   fr: 'Ee akeed' },
    'i will try not to take much of your time': { ar: 'ما بطوّل عليك إن شاء الله', fr: 'Ma batawwil 3alaik in sha Allah' },
    'take your time':               { ar: 'خذ راحتك',                  fr: 'Khadh rahtak' },

    // Guiding the Conversation & Empathy
    'if i exhaust you you can ask me to stop anytime': { ar: 'إذا حسّيت إنك تعبت، قول لي نوقف', fr: 'Idha hassait innik ti3abt, gul li nwaggif' },
    'thank you doctor':             { ar: 'مشكور يا دكتور',            fr: 'Mashkoor ya doktor' },
    'can you concentrate with me please': { ar: 'ممكن تركّز وياي شوي؟', fr: 'Mumkin trakkiz wiyyay shway?' },
    'yes i am with you':            { ar: 'إي وياك',                   fr: 'Ee wiyyak' },
    'can you speak a bit slowly sir': { ar: 'ممكن تتكلم على مهلك شوي؟', fr: 'Mumkin titkallam 3ala mahlik shway?' },
    'okay sorry':                   { ar: 'زين، آسف',                  fr: 'Zain, asif' },
    'what did you say':             { ar: 'نعم؟ / شنو قلت؟',           fr: 'Na3am? / Shino gilt?' },
    'i said i have pain':           { ar: 'أقول عندي وجع',             fr: 'Agool 3indi waja3' },
    'may god heal your illness':    { ar: 'الله يشفيك',                fr: 'Allah yishfeek' },
    'amen':                         { ar: 'آمين',                      fr: 'Ameen' },
    'im sorry sir but i dont know': { ar: 'أنا آسف، بس ما أدري',       fr: 'Ana asif, bass ma adri' },
    'no problem':                   { ar: 'ما في مشكلة',               fr: 'Ma fee mushkila' },
    'god forbids':                  { ar: 'لا قدّر الله',              fr: 'La gaddar Allah' },
    'praise god':                   { ar: 'الحمد لله',                 fr: 'Al-hamdulillah' },
  },
};
