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
    batch: 3,
    // Batches are signed off individually — reviewedThrough is the highest batch
    // a human has actually checked. Anything above it is still an AI draft.
    reviewedThrough: 2,            // ← raise this as each batch is reviewed
    covers: ['Communication & Ethics', 'General History Taking', 'Chest (Respiratory)'],
    note: 'Batches 1-2 reviewed & approved by the product owner. Batch 3 (chest) awaiting review.',
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

    /* ===== Batch 3 — Chest (Respiratory) =====
       Investigation NAMES (chest x-ray, pleural biopsy…) are MSA medical terms
       that read the same in every dialect, so they're deliberately left alone —
       only the patient's replies change. */
    // Productive cough
    'does the cough come with sputum or not': { ar: 'الكحة ناشفة ولا فيها بلغم؟', fr: 'Al-kahha nashfa wala feeha balgham?' },
    'yes with sputum':              { ar: 'أيوه، فيها بلغم',           fr: 'Aywa, feeha balgham' },
    'what is the amount of the expectoration': { ar: 'كم كمية البلغم؟', fr: 'Kam kimmiyat al-balgham?' },
    'a moderate amount':            { ar: 'كمية متوسطة',               fr: 'Kimmiya mutawassita' },
    'what is the colour of the sputum': { ar: 'وش لون البلغم؟',        fr: 'Wesh lon al-balgham?' },
    'yellowish':                    { ar: 'مصفرّ',                     fr: 'Musaffar' },
    'is it clear white or grayish':  { ar: 'أبيض ولا رمادي؟',          fr: 'Abyad wala ramadi?' },
    'no its yellow':                { ar: 'لا، أصفر',                  fr: 'La, asfar' },
    'is it foamy pink':             { ar: 'زي الرغوة ووردي شوي؟',      fr: 'Zay ar-raghwa wa wardi shway?' },
    'is it greenish or yellowish':  { ar: 'أصفر ولا أخضر؟',            fr: 'Asfar wala akhdar?' },
    'what does the sputum look like consistency': { ar: 'وش شكل البلغم؟', fr: 'Wesh shakl al-balgham?' },
    'its thick':                    { ar: 'لزج',                       fr: 'Lazij' },
    'is it watery':                 { ar: 'سائل زي الماي؟',            fr: 'Sa\'il zay al-may?' },
    'is it frothy':                 { ar: 'زي الرغوة؟',                fr: 'Zay ar-raghwa?' },
    'is it thick':                  { ar: 'لزج؟',                      fr: 'Lazij?' },
    'yes thick':                    { ar: 'أيوه، لزج',                 fr: 'Aywa, lazij' },
    'does it smell offensive':      { ar: 'ريحته كريهة؟',              fr: 'Reehtu kareeha?' },
    'yes a bad smell':              { ar: 'أيوه، ريحته كريهة',         fr: 'Aywa, reehtu kareeha' },
    'postural variation  does it increase when you lie in lateral position': { ar: 'تزيد لما تنام على جنبك؟', fr: 'Tizeed lamma tnam 3ala jambak?' },
    'yes on my side':               { ar: 'أيوه، على جنبي',            fr: 'Aywa, 3ala jambi' },
    'does it increase on stooping forward': { ar: 'تزيد لما تنحني قدام؟', fr: 'Tizeed lamma tinhani guddam?' },
    'diurnal variation  does it come throughout the day': { ar: 'الكحة تجيك طول اليوم؟', fr: 'Al-kahha tjeek tool al-yom?' },
    'its more in the morning':      { ar: 'أكثر الصبح',                fr: 'Akthar as-subh' },
    'or is it more in the morning or at night': { ar: 'ولا تزيد الصبح ولا بالليل؟', fr: 'Wala tizeed as-subh wala bil-lail?' },
    'in the morning':               { ar: 'الصبح',                     fr: 'As-subh' },
    'seasonal variation  does it come throughout the year': { ar: 'الكحة تجيك طول السنة؟', fr: 'Al-kahha tjeek tool as-sana?' },
    'its worse in winter':          { ar: 'تزيد في الشتا',             fr: 'Tizeed fish-shita' },
    'or is it more during winter or spring': { ar: 'ولا تزيد في الشتا ولا الربيع؟', fr: 'Wala tizeed fish-shita wala ar-rabee3?' },
    'in winter':                    { ar: 'في الشتا',                  fr: 'Fish-shita' },

    // Wheezes
    'do you have chest wheezes':    { ar: 'عندك صفير في صدرك؟',        fr: '3indak safeer fi sadrak?' },
    'yes wheezing':                 { ar: 'أيوه، صفير',                fr: 'Aywa, safeer' },
    'when does the wheezing occur': { ar: 'متى يجيك الصفير؟',          fr: 'Mata yjeek as-safeer?' },
    'at night':                     { ar: 'بالليل',                    fr: 'Bil-lail' },

    // Constitutional / 'toxic' symptoms
    'do you have night fevers':     { ar: 'عندك حرارة بالليل؟',        fr: '3indak harara bil-lail?' },
    'yes at night':                 { ar: 'أيوه، بالليل',              fr: 'Aywa, bil-lail' },
    'do you sweat excessively during night': { ar: 'تعرق كثير بالليل؟', fr: 'Ti3rag katheer bil-lail?' },
    'yes a lot':                    { ar: 'أيوه، كثير',                fr: 'Aywa, katheer' },
    'is there any weight loss':     { ar: 'وزنك ناقص؟',                fr: 'Waznak nagis?' },
    'yes i lost weight':            { ar: 'أيوه، وزني نقص',            fr: 'Aywa, wazni nagas' },
    'is there any loss of appetite': { ar: 'في تغيّر في شهيتك؟',       fr: 'Fee taghayyur fi shahiyyatak?' },
    'yes no appetite':              { ar: 'أيوه، ما لي نفس',           fr: 'Aywa, ma li nafs' },

    // Replies to proposed investigations
    'okay ill do it':               { ar: 'طيب، بسوّيها',              fr: 'Tayyib, basawweeha' },
    'okay doctor':                  { ar: 'طيب يا دكتور',              fr: 'Tayyib ya doktor' },
    'alright':                      { ar: 'طيب',                       fr: 'Tayyib' },
    'okay':                         { ar: 'طيب',                       fr: 'Tayyib' },
    'ill give a sample':            { ar: 'بجيب عينة',                 fr: 'Bajeeb 3ayyina' },
    'okay if needed':               { ar: 'طيب، لو لازم',              fr: 'Tayyib, law lazim' },
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

    /* ===== Batch 3 — Chest (Respiratory) =====
       Investigation NAMES are MSA medical terms, identical across dialects, so
       only the patient's replies are translated here. */
    // Productive cough
    'does the cough come with sputum or not': { ar: 'الكحة ناشفة ولا فيها بلغم؟', fr: 'Al-kahha nashfa wala feeha balgham?' },
    'yes with sputum':              { ar: 'إي، فيها بلغم',             fr: 'Ee, feeha balgham' },
    'what is the amount of the expectoration': { ar: 'كم كمية البلغم؟', fr: 'Kam kimmiyat al-balgham?' },
    'a moderate amount':            { ar: 'كمية متوسطة',               fr: 'Kimmiya mutawassita' },
    'what is the colour of the sputum': { ar: 'شنو لون البلغم؟',       fr: 'Shino lon al-balgham?' },
    'yellowish':                    { ar: 'مصفرّ',                     fr: 'Musaffar' },
    'is it clear white or grayish':  { ar: 'أبيض ولا رمادي؟',          fr: 'Abyadh wala ramadi?' },
    'no its yellow':                { ar: 'لا، أصفر',                  fr: 'La, asfar' },
    'is it foamy pink':             { ar: 'مثل الرغوة ووردي شوي؟',     fr: 'Mithl ar-raghwa w wardi shway?' },
    'is it greenish or yellowish':  { ar: 'أصفر ولا أخضر؟',            fr: 'Asfar wala akhdhar?' },
    'what does the sputum look like consistency': { ar: 'شنو شكل البلغم؟', fr: 'Shino shakl al-balgham?' },
    'its thick':                    { ar: 'لزج',                       fr: 'Lazij' },
    'is it watery':                 { ar: 'سائل مثل الماي؟',           fr: 'Sa\'il mithl al-may?' },
    'is it frothy':                 { ar: 'مثل الرغوة؟',               fr: 'Mithl ar-raghwa?' },
    'is it thick':                  { ar: 'لزج؟',                      fr: 'Lazij?' },
    'yes thick':                    { ar: 'إي، لزج',                   fr: 'Ee, lazij' },
    'does it smell offensive':      { ar: 'ريحته كريهة؟',              fr: 'Reehta kareeha?' },
    'yes a bad smell':              { ar: 'إي، ريحته كريهة',           fr: 'Ee, reehta kareeha' },
    'postural variation  does it increase when you lie in lateral position': { ar: 'تزيد لمن تنام على جنبك؟', fr: 'Tzeed liman tnam 3ala jambik?' },
    'yes on my side':               { ar: 'إي، على جنبي',              fr: 'Ee, 3ala jambi' },
    'does it increase on stooping forward': { ar: 'تزيد لمن تنحني قدام؟', fr: 'Tzeed liman tinhani giddam?' },
    'diurnal variation  does it come throughout the day': { ar: 'الكحة تجيك طول اليوم؟', fr: 'Al-kahha tjeek tool al-yom?' },
    'its more in the morning':      { ar: 'أكثر الصبح',                fr: 'Akthar as-subh' },
    'or is it more in the morning or at night': { ar: 'ولا تزيد الصبح ولا بالليل؟', fr: 'Wala tzeed as-subh wala bil-lail?' },
    'in the morning':               { ar: 'الصبح',                     fr: 'As-subh' },
    'seasonal variation  does it come throughout the year': { ar: 'الكحة تجيك طول السنة؟', fr: 'Al-kahha tjeek tool as-sana?' },
    'its worse in winter':          { ar: 'تزيد بالشتا',               fr: 'Tzeed bish-shita' },
    'or is it more during winter or spring': { ar: 'ولا تزيد بالشتا ولا الربيع؟', fr: 'Wala tzeed bish-shita wala ar-rabee3?' },
    'in winter':                    { ar: 'بالشتا',                    fr: 'Bish-shita' },

    // Wheezes
    'do you have chest wheezes':    { ar: 'عندك صفير بصدرك؟',          fr: '3indik safeer b-sadrik?' },
    'yes wheezing':                 { ar: 'إي، صفير',                  fr: 'Ee, safeer' },
    'when does the wheezing occur': { ar: 'متى يجيك الصفير؟',          fr: 'Mita yjeek as-safeer?' },
    'at night':                     { ar: 'بالليل',                    fr: 'Bil-lail' },

    // Constitutional / 'toxic' symptoms
    'do you have night fevers':     { ar: 'عندك حرارة بالليل؟',        fr: '3indik harara bil-lail?' },
    'yes at night':                 { ar: 'إي، بالليل',                fr: 'Ee, bil-lail' },
    'do you sweat excessively during night': { ar: 'تعرق وايد بالليل؟', fr: 'Ti3rag wayid bil-lail?' },
    'yes a lot':                    { ar: 'إي، وايد',                  fr: 'Ee, wayid' },
    'is there any weight loss':     { ar: 'وزنك ناقص؟',                fr: 'Waznik nagis?' },
    'yes i lost weight':            { ar: 'إي، وزني نقص',              fr: 'Ee, wazni nagas' },
    'is there any loss of appetite': { ar: 'في تغيّر بشهيتك؟',         fr: 'Fee taghayyur b-shahiyyatik?' },
    'yes no appetite':              { ar: 'إي، ما لي نفس',             fr: 'Ee, ma li nafs' },

    // Replies to proposed investigations
    'okay ill do it':               { ar: 'زين، بسوّيها',              fr: 'Zain, basawweeha' },
    'okay doctor':                  { ar: 'زين يا دكتور',              fr: 'Zain ya doktor' },
    'alright':                      { ar: 'زين',                       fr: 'Zain' },
    'okay':                         { ar: 'زين',                       fr: 'Zain' },
    'ill give a sample':            { ar: 'بجيب عينة',                 fr: 'Bajeeb 3ayyina' },
    'okay if needed':               { ar: 'زين، إذا لازم',             fr: 'Zain, idha lazim' },
  },
};
