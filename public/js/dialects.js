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
    batch: 2,
    reviewed: false,               // ← flip to true only after a native speaker checks it
    covers: ['Communication & Ethics', 'General History Taking'],
    note: 'Draft batches 1-2 — greetings/permission/empathy, then personal, present, past, family history.',
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

    /* ===== Batch 2 — General History Taking ===== */
    // Personal History
    'what is your name':            { ar: 'وش اسمك؟',                  fr: 'Wesh ismak?' },
    'my name is mohamed':           { ar: 'اسمي محمد',                 fr: 'Ismi Mohamed' },
    'how old are you':              { ar: 'كم عمرك؟',                  fr: 'Kam 3umrak?' },
    'i am 45 years old':            { ar: 'عمري خمسة وأربعين سنة',     fr: '3umri khamsa wa arba3een sana' },
    'what are you working as':      { ar: 'وش تشتغل؟',                 fr: 'Wesh tishtaghil?' },
    'i am a teacher':               { ar: 'أنا مدرّس',                 fr: 'Ana mudarris' },
    'are you married or not':       { ar: 'متزوج ولا لسّه؟',           fr: 'Mitzawwij wala lissa?' },
    'i am married':                 { ar: 'متزوج',                     fr: 'Mitzawwij' },
    'do you have any children how many': { ar: 'عندك عيال؟ كم؟',       fr: '3indak 3iyal? Kam?' },
    'yes three children':           { ar: 'أيوه، ثلاثة',               fr: 'Aywa, thalatha' },
    'where do you live':            { ar: 'وين ساكن؟',                 fr: 'Wain sakin?' },
    'are you righthanded or left handed': { ar: 'تكتب باليمين ولا الشمال؟', fr: 'Tiktub bil-yameen wala ash-shimal?' },
    'righthanded':                  { ar: 'باليمين',                   fr: 'Bil-yameen' },

    // Chief Complaint & Present History
    'what is disturbing you':       { ar: 'وش اللي تعبك؟',             fr: 'Wesh illi ta3bak?' },
    'severe pain in my stomach':    { ar: 'ألم شديد في بطني',          fr: 'Alam shadeed fi batni' },
    'what brings you to the hospital': { ar: 'وش جابك للمستشفى؟',      fr: 'Wesh jabak lil-mustashfa?' },
    'i am vomiting':                { ar: 'أستفرغ',                    fr: 'Astafrigh' },
    'how did the problem start suddenly or gradually': { ar: 'كيف بدت المشكلة؟ فجأة ولا بالتدريج؟', fr: 'Kaif bidat al-mushkila? Faj\'a wala bit-tadreej?' },
    'it started suddenly':          { ar: 'بدت فجأة',                  fr: 'Bidat faj\'a' },
    'is it progressive or regressive': { ar: 'تزيد ولا تقل؟',          fr: 'Tizeed wala tigill?' },
    'it is increasing':             { ar: 'تزيد',                      fr: 'Tizeed' },
    'how long has the problem occurred': { ar: 'من متى والحالة كذا؟',  fr: 'Min mata wal-hala kida?' },
    'for three days':               { ar: 'من ثلاث أيام',              fr: 'Min thalath ayyam' },
    'did you have any investigations done': { ar: 'سوّيت تحاليل أو أشعة؟', fr: 'Sawwait tahaleel aw ashi3a?' },
    'i did a blood test':           { ar: 'سوّيت تحليل دم',            fr: 'Sawwait tahleel dam' },
    'do you have a fever':          { ar: 'عندك حرارة؟',               fr: '3indak harara?' },
    'yes high fever':               { ar: 'أيوه، حرارة عالية',         fr: 'Aywa, harara 3alya' },
    'did you lose weight':          { ar: 'نقص وزنك؟',                 fr: 'Nagas waznak?' },
    'no':                           { ar: 'لا',                        fr: 'La' },
    'do you have chest pain':       { ar: 'عندك ألم في صدرك؟',         fr: '3indak alam fi sadrak?' },
    'no just my stomach':           { ar: 'لا، بطني بس',               fr: 'La, batni bass' },

    // Past Medical History & Special Habits
    'do you have any previous medical problems': { ar: 'تعالجت من أي شي قبل؟', fr: 'T3alajt min ay shai gabl?' },
    'no nothing':                   { ar: 'لا، ما فيه',                fr: 'La, ma feeh' },
    'do you have diabetes':         { ar: 'عندك سكري؟',                fr: '3indak sukkari?' },
    'yes':                          { ar: 'أيوه',                      fr: 'Aywa' },
    'do you have hypertension':     { ar: 'عندك ضغط؟',                 fr: '3indak daght?' },
    'do you receive any treatment': { ar: 'تاخذ أي علاج؟',             fr: 'Takhudh ay 3ilaj?' },
    'pills for diabetes':           { ar: 'حبوب للسكري',               fr: 'Hboob lis-sukkari' },
    'do you have allergies to any medications': { ar: 'عندك حساسية من أي دوا؟', fr: '3indak hasasiya min ay dawa?' },
    'have you had any operations before': { ar: 'سوّيت أي عملية قبل؟', fr: 'Sawwait ay 3amaliya gabl?' },
    'appendectomy':                 { ar: 'شلّيت الزايدة',             fr: 'Shillait az-zayda' },
    'do you smoke':                 { ar: 'تدخّن؟',                    fr: 'Tdakhkhin?' },
    'how many packs per day':       { ar: 'كم علبة في اليوم؟',         fr: 'Kam 3ilba fil-yom?' },
    'one pack':                     { ar: 'علبة وحدة',                 fr: '3ilba wahda' },

    // Family History
    'is there any person in your family having the same problem': { ar: 'أحد في العائلة عنده نفس الشكوى؟', fr: 'Ahad fil-3a\'ila 3indu nafs ash-shakwa?' },
    'are your father and mother close relatives': { ar: 'أبوك وأمك قرايب؟', fr: 'Abook wa ummak garayib?' },
    'does anybody in your family have heart disease': { ar: 'أحد في العائلة عنده مرض قلب؟', fr: 'Ahad fil-3a\'ila 3indu marad galb?' },
    'yes my father':                { ar: 'أيوه، أبوي',                fr: 'Aywa, abooy' },
    'are your parents still alive': { ar: 'أبوك وأمك لسّه عايشين؟',    fr: 'Abook wa ummak lissa 3aysheen?' },
    'yes thank god':                { ar: 'أيوه، الحمد لله',           fr: 'Aywa, al-hamdulillah' },
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

    /* ===== Batch 2 — General History Taking ===== */
    // Personal History
    'what is your name':            { ar: 'شنو اسمك؟',                 fr: 'Shino ismik?' },
    'my name is mohamed':           { ar: 'اسمي محمد',                 fr: 'Ismi Mohamed' },
    'how old are you':              { ar: 'كم عمرك؟',                  fr: 'Kam 3umrik?' },
    'i am 45 years old':            { ar: 'عمري خمسة وأربعين سنة',     fr: '3umri khamsa w arba3een sana' },
    'what are you working as':      { ar: 'شنو تشتغل؟',                fr: 'Shino tishtaghil?' },
    'i am a teacher':               { ar: 'أنا مدرّس',                 fr: 'Ana mudarris' },
    'are you married or not':       { ar: 'متزوج ولا بعد؟',            fr: 'Mitzawwij wala ba3ad?' },
    'i am married':                 { ar: 'متزوج',                     fr: 'Mitzawwij' },
    'do you have any children how many': { ar: 'عندك عيال؟ كم؟',       fr: '3indik 3iyal? Kam?' },
    'yes three children':           { ar: 'إي، ثلاثة',                 fr: 'Ee, thalatha' },
    'where do you live':            { ar: 'وين ساكن؟',                 fr: 'Wain sakin?' },
    'are you righthanded or left handed': { ar: 'تكتب باليمين ولا اليسار؟', fr: 'Tiktib bil-yameen wala al-yasar?' },
    'righthanded':                  { ar: 'باليمين',                   fr: 'Bil-yameen' },

    // Chief Complaint & Present History
    'what is disturbing you':       { ar: 'شنو اللي يتعبك؟',           fr: 'Shino illi yit3ibik?' },
    'severe pain in my stomach':    { ar: 'وجع قوي ببطني',             fr: 'Waja3 gawi b-batni' },
    'what brings you to the hospital': { ar: 'شنو جابك للمستشفى؟',     fr: 'Shino jabik lil-mustashfa?' },
    'i am vomiting':                { ar: 'أستفرغ',                    fr: 'Astafrigh' },
    'how did the problem start suddenly or gradually': { ar: 'شلون بدت المشكلة؟ فجأة ولا بالتدريج؟', fr: 'Shlon bidat al-mushkila? Faj\'a wala bit-tadreej?' },
    'it started suddenly':          { ar: 'بدت فجأة',                  fr: 'Bidat faj\'a' },
    'is it progressive or regressive': { ar: 'تزيد ولا تقل؟',          fr: 'Tzeed wala tgill?' },
    'it is increasing':             { ar: 'تزيد',                      fr: 'Tzeed' },
    'how long has the problem occurred': { ar: 'من متى والحالة كذي؟',  fr: 'Min mita wal-hala kidhi?' },
    'for three days':               { ar: 'من ثلاث أيام',              fr: 'Min thalath ayyam' },
    'did you have any investigations done': { ar: 'سوّيت تحاليل ولا أشعة؟', fr: 'Sawwait tahaleel wala ashi3a?' },
    'i did a blood test':           { ar: 'سوّيت تحليل دم',            fr: 'Sawwait tahleel dam' },
    'do you have a fever':          { ar: 'عندك حرارة؟',               fr: '3indik harara?' },
    'yes high fever':               { ar: 'إي، حرارة عالية',           fr: 'Ee, harara 3alya' },
    'did you lose weight':          { ar: 'نقص وزنك؟',                 fr: 'Nagas waznik?' },
    'no':                           { ar: 'لا',                        fr: 'La' },
    'do you have chest pain':       { ar: 'عندك وجع بصدرك؟',           fr: '3indik waja3 b-sadrik?' },
    'no just my stomach':           { ar: 'لا، بطني بس',               fr: 'La, batni bass' },

    // Past Medical History & Special Habits
    'do you have any previous medical problems': { ar: 'تعالجت من أي شي قبل؟', fr: 'T3alajt min ay shay gabl?' },
    'no nothing':                   { ar: 'لا، ما في',                 fr: 'La, ma fee' },
    'do you have diabetes':         { ar: 'عندك سكر؟',                 fr: '3indik sukkar?' },
    'yes':                          { ar: 'إي',                        fr: 'Ee' },
    'do you have hypertension':     { ar: 'عندك ضغط؟',                 fr: '3indik daght?' },
    'do you receive any treatment': { ar: 'تاخذ أي علاج؟',             fr: 'Takhidh ay 3ilaj?' },
    'pills for diabetes':           { ar: 'حبوب للسكر',                fr: 'Hboob lis-sukkar' },
    'do you have allergies to any medications': { ar: 'عندك حساسية من أي دوا؟', fr: '3indik hasasiya min ay dawa?' },
    'have you had any operations before': { ar: 'سوّيت أي عملية قبل؟', fr: 'Sawwait ay 3amaliya gabl?' },
    'appendectomy':                 { ar: 'شلّيت الزايدة',             fr: 'Shillait az-zayda' },
    'do you smoke':                 { ar: 'تدخّن؟',                    fr: 'Tdakhkhin?' },
    'how many packs per day':       { ar: 'كم علبة باليوم؟',           fr: 'Kam 3ilba bil-yom?' },
    'one pack':                     { ar: 'علبة وحدة',                 fr: '3ilba wahda' },

    // Family History
    'is there any person in your family having the same problem': { ar: 'أحد بالعائلة عنده نفس الشكوى؟', fr: 'Ahad bil-3a\'ila 3inda nafs ash-shakwa?' },
    'are your father and mother close relatives': { ar: 'أبوك وأمك قرايب؟', fr: 'Ubook w ummik garayib?' },
    'does anybody in your family have heart disease': { ar: 'أحد بالعائلة عنده مرض قلب؟', fr: 'Ahad bil-3a\'ila 3inda marad galb?' },
    'yes my father':                { ar: 'إي، أبوي',                  fr: 'Ee, abooy' },
    'are your parents still alive': { ar: 'أبوك وأمك بعدهم عايشين؟',   fr: 'Abook w ummik ba3adhum 3aysheen?' },
    'yes thank god':                { ar: 'إي، الحمد لله',             fr: 'Ee, al-hamdulillah' },
  },
};
