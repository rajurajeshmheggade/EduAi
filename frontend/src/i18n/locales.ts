/**
 * Parent / student-facing strings. English is the reference; Hindi, Kannada and Tamil are DRAFT translations that
 * must be reviewed by native speakers before release (see docs/PRAVESH_M1.md).
 */
export const LANGUAGES = [
  { code: 'en', label: 'English', font: null },
  { code: 'hi', label: 'हिंदी', font: 'Noto Sans Devanagari' },
  { code: 'kn', label: 'ಕನ್ನಡ', font: 'Noto Sans Kannada' },
  { code: 'ta', label: 'தமிழ்', font: 'Noto Sans Tamil' },
] as const
export type LangCode = (typeof LANGUAGES)[number]['code']

const en = {
  nav: { home: 'Home' },
  common: { close: 'Close', cancel: 'Cancel', loading: 'Loading…', error: 'Something went wrong. Please try again.', language: 'Language' },
  portal: {
    title: 'Parent portal', greeting: 'Namaste, {{name}}', school: '{{school}} · Admissions', children: 'Your children',
    class: 'Applying for Class {{grade}}', empty: 'No admission applications are linked to your account yet. Please contact the school office.',
    noNotice: 'The school has not published its consent notice yet.',
    footer: "Your data is processed for {{school}} under India's DPDP Act, 2023.",
  },
  consent: {
    granted: 'Consent given (version {{version}})', withdrawn: 'Consent withdrawn', pending: 'Consent needed',
    outdated: 'The notice has changed — please review it', read: 'Read and give consent', review: 'Review consent',
    withdraw: 'Withdraw consent', title: 'Consent notice', version: 'Version {{version}}',
    confirm: "I am {{child}}'s parent or guardian. I have read this notice and I agree.", submit: 'Give consent',
    saved: 'Thank you. Your consent has been recorded.', withdrawnMsg: 'Your consent has been withdrawn.',
    draftNote: 'This translation is a draft. If anything is unclear, the English version is the reference.',
  },
  privacy: {
    title: 'Privacy requests', intro: "You can ask the school to show, correct or delete your child's data, or raise a grievance.",
    kind: { access: "See my child's data", correction: 'Correct something', erasure: "Delete my child's data",
      consent_withdrawal: 'Withdraw consent', grievance: 'Raise a grievance' },
    details: 'Details (optional)', send: 'Send request', sent: 'Request sent. The school will reply by {{date}}.',
    status: { open: 'Open', in_progress: 'In progress', completed: 'Completed', rejected: 'Closed' },
    none: 'No requests yet.', child: 'About', allChildren: 'All my children', type: 'Request',
  },
}

type Dict = typeof en

const hi: Dict = {
  nav: { home: 'होम' },
  common: { close: 'बंद करें', cancel: 'रद्द करें', loading: 'लोड हो रहा है…', error: 'कुछ गलत हो गया। कृपया फिर से कोशिश करें।', language: 'भाषा' },
  portal: {
    title: 'अभिभावक पोर्टल', greeting: 'नमस्ते, {{name}}', school: '{{school}} · प्रवेश', children: 'आपके बच्चे',
    class: 'कक्षा {{grade}} के लिए आवेदन', empty: 'आपके खाते से अभी कोई प्रवेश आवेदन जुड़ा नहीं है। कृपया स्कूल कार्यालय से संपर्क करें।',
    noNotice: 'स्कूल ने अभी सहमति नोटिस प्रकाशित नहीं किया है।',
    footer: 'आपका डेटा भारत के डीपीडीपी अधिनियम, 2023 के तहत {{school}} के लिए संसाधित किया जाता है।',
  },
  consent: {
    granted: 'सहमति दी गई (संस्करण {{version}})', withdrawn: 'सहमति वापस ली गई', pending: 'सहमति आवश्यक है',
    outdated: 'नोटिस बदल गया है — कृपया दोबारा देखें', read: 'पढ़ें और सहमति दें', review: 'सहमति देखें',
    withdraw: 'सहमति वापस लें', title: 'सहमति नोटिस', version: 'संस्करण {{version}}',
    confirm: 'मैं {{child}} का/की माता-पिता या अभिभावक हूँ। मैंने यह नोटिस पढ़ लिया है और मैं सहमत हूँ।', submit: 'सहमति दें',
    saved: 'धन्यवाद। आपकी सहमति दर्ज कर ली गई है।', withdrawnMsg: 'आपकी सहमति वापस ले ली गई है।',
    draftNote: 'यह अनुवाद प्रारूप है। कोई बात स्पष्ट न हो तो अंग्रेज़ी संस्करण ही मान्य है।',
  },
  privacy: {
    title: 'गोपनीयता अनुरोध', intro: 'आप स्कूल से अपने बच्चे का डेटा दिखाने, सुधारने या हटाने के लिए कह सकते हैं, या शिकायत दर्ज कर सकते हैं।',
    kind: { access: 'मेरे बच्चे का डेटा दिखाएँ', correction: 'कुछ सुधार करें', erasure: 'मेरे बच्चे का डेटा हटाएँ',
      consent_withdrawal: 'सहमति वापस लें', grievance: 'शिकायत दर्ज करें' },
    details: 'विवरण (वैकल्पिक)', send: 'अनुरोध भेजें', sent: 'अनुरोध भेज दिया गया। स्कूल {{date}} तक उत्तर देगा।',
    status: { open: 'खुला', in_progress: 'प्रगति में', completed: 'पूरा', rejected: 'बंद' },
    none: 'अभी कोई अनुरोध नहीं।', child: 'किसके बारे में', allChildren: 'मेरे सभी बच्चे', type: 'अनुरोध',
  },
}

const kn: Dict = {
  nav: { home: 'ಮುಖಪುಟ' },
  common: { close: 'ಮುಚ್ಚಿ', cancel: 'ರದ್ದುಮಾಡಿ', loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…', error: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.', language: 'ಭಾಷೆ' },
  portal: {
    title: 'ಪೋಷಕರ ಪೋರ್ಟಲ್', greeting: 'ನಮಸ್ಕಾರ, {{name}}', school: '{{school}} · ಪ್ರವೇಶ', children: 'ನಿಮ್ಮ ಮಕ್ಕಳು',
    class: '{{grade}}ನೇ ತರಗತಿಗೆ ಅರ್ಜಿ', empty: 'ನಿಮ್ಮ ಖಾತೆಗೆ ಇನ್ನೂ ಯಾವುದೇ ಪ್ರವೇಶ ಅರ್ಜಿ ಜೋಡಿಸಲಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಶಾಲಾ ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.',
    noNotice: 'ಶಾಲೆ ಇನ್ನೂ ಸಮ್ಮತಿ ಸೂಚನೆಯನ್ನು ಪ್ರಕಟಿಸಿಲ್ಲ.',
    footer: 'ಭಾರತದ ಡಿಪಿಡಿಪಿ ಕಾಯ್ದೆ, 2023ರ ಅಡಿಯಲ್ಲಿ ನಿಮ್ಮ ಮಾಹಿತಿಯನ್ನು {{school}} ಪರವಾಗಿ ಸಂಸ್ಕರಿಸಲಾಗುತ್ತದೆ.',
  },
  consent: {
    granted: 'ಸಮ್ಮತಿ ನೀಡಲಾಗಿದೆ (ಆವೃತ್ತಿ {{version}})', withdrawn: 'ಸಮ್ಮತಿ ಹಿಂಪಡೆಯಲಾಗಿದೆ', pending: 'ಸಮ್ಮತಿ ಅಗತ್ಯವಿದೆ',
    outdated: 'ಸೂಚನೆ ಬದಲಾಗಿದೆ — ದಯವಿಟ್ಟು ಮತ್ತೆ ಪರಿಶೀಲಿಸಿ', read: 'ಓದಿ ಮತ್ತು ಸಮ್ಮತಿ ನೀಡಿ', review: 'ಸಮ್ಮತಿ ನೋಡಿ',
    withdraw: 'ಸಮ್ಮತಿ ಹಿಂಪಡೆಯಿರಿ', title: 'ಸಮ್ಮತಿ ಸೂಚನೆ', version: 'ಆವೃತ್ತಿ {{version}}',
    confirm: 'ನಾನು {{child}} ಅವರ ಪೋಷಕ ಅಥವಾ ರಕ್ಷಕ. ಈ ಸೂಚನೆಯನ್ನು ಓದಿದ್ದೇನೆ ಮತ್ತು ಒಪ್ಪುತ್ತೇನೆ.', submit: 'ಸಮ್ಮತಿ ನೀಡಿ',
    saved: 'ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಸಮ್ಮತಿಯನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ.', withdrawnMsg: 'ನಿಮ್ಮ ಸಮ್ಮತಿಯನ್ನು ಹಿಂಪಡೆಯಲಾಗಿದೆ.',
    draftNote: 'ಈ ಅನುವಾದ ಕರಡು ರೂಪದಲ್ಲಿದೆ. ಸ್ಪಷ್ಟವಾಗದಿದ್ದರೆ ಇಂಗ್ಲಿಷ್ ಆವೃತ್ತಿಯೇ ಮಾನ್ಯ.',
  },
  privacy: {
    title: 'ಗೌಪ್ಯತೆ ವಿನಂತಿಗಳು', intro: 'ನಿಮ್ಮ ಮಗುವಿನ ಮಾಹಿತಿಯನ್ನು ತೋರಿಸಲು, ತಿದ್ದಲು ಅಥವಾ ಅಳಿಸಲು ಶಾಲೆಯನ್ನು ಕೇಳಬಹುದು ಅಥವಾ ದೂರು ನೀಡಬಹುದು.',
    kind: { access: 'ನನ್ನ ಮಗುವಿನ ಮಾಹಿತಿ ತೋರಿಸಿ', correction: 'ಏನನ್ನಾದರೂ ತಿದ್ದಿ', erasure: 'ನನ್ನ ಮಗುವಿನ ಮಾಹಿತಿ ಅಳಿಸಿ',
      consent_withdrawal: 'ಸಮ್ಮತಿ ಹಿಂಪಡೆಯಿರಿ', grievance: 'ದೂರು ನೀಡಿ' },
    details: 'ವಿವರಗಳು (ಐಚ್ಛಿಕ)', send: 'ವಿನಂತಿ ಕಳುಹಿಸಿ', sent: 'ವಿನಂತಿ ಕಳುಹಿಸಲಾಗಿದೆ. ಶಾಲೆ {{date}} ಒಳಗೆ ಉತ್ತರಿಸುತ್ತದೆ.',
    status: { open: 'ತೆರೆದಿದೆ', in_progress: 'ಪ್ರಗತಿಯಲ್ಲಿದೆ', completed: 'ಪೂರ್ಣಗೊಂಡಿದೆ', rejected: 'ಮುಚ್ಚಲಾಗಿದೆ' },
    none: 'ಇನ್ನೂ ಯಾವುದೇ ವಿನಂತಿಗಳಿಲ್ಲ.', child: 'ಯಾರ ಬಗ್ಗೆ', allChildren: 'ನನ್ನ ಎಲ್ಲಾ ಮಕ್ಕಳು', type: 'ವಿನಂತಿ',
  },
}

const ta: Dict = {
  nav: { home: 'முகப்பு' },
  common: { close: 'மூடு', cancel: 'ரத்து', loading: 'ஏற்றுகிறது…', error: 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.', language: 'மொழி' },
  portal: {
    title: 'பெற்றோர் தளம்', greeting: 'வணக்கம், {{name}}', school: '{{school}} · சேர்க்கை', children: 'உங்கள் குழந்தைகள்',
    class: '{{grade}}-ஆம் வகுப்புக்கு விண்ணப்பம்', empty: 'உங்கள் கணக்குடன் இன்னும் சேர்க்கை விண்ணப்பம் எதுவும் இணைக்கப்படவில்லை. பள்ளி அலுவலகத்தைத் தொடர்புகொள்ளவும்.',
    noNotice: 'பள்ளி இன்னும் ஒப்புதல் அறிவிப்பை வெளியிடவில்லை.',
    footer: 'இந்தியாவின் டிபிடிபி சட்டம், 2023-இன் கீழ் உங்கள் தரவு {{school}}-க்காகச் செயலாக்கப்படுகிறது.',
  },
  consent: {
    granted: 'ஒப்புதல் அளிக்கப்பட்டது (பதிப்பு {{version}})', withdrawn: 'ஒப்புதல் திரும்பப் பெறப்பட்டது', pending: 'ஒப்புதல் தேவை',
    outdated: 'அறிவிப்பு மாறியுள்ளது — மீண்டும் பார்க்கவும்', read: 'படித்து ஒப்புதல் அளிக்கவும்', review: 'ஒப்புதலைப் பார்க்கவும்',
    withdraw: 'ஒப்புதலைத் திரும்பப் பெறவும்', title: 'ஒப்புதல் அறிவிப்பு', version: 'பதிப்பு {{version}}',
    confirm: 'நான் {{child}}-இன் பெற்றோர் அல்லது பாதுகாவலர். இந்த அறிவிப்பைப் படித்தேன், ஒப்புக்கொள்கிறேன்.', submit: 'ஒப்புதல் அளிக்கவும்',
    saved: 'நன்றி. உங்கள் ஒப்புதல் பதிவு செய்யப்பட்டது.', withdrawnMsg: 'உங்கள் ஒப்புதல் திரும்பப் பெறப்பட்டது.',
    draftNote: 'இந்த மொழிபெயர்ப்பு வரைவு நிலையில் உள்ளது. தெளிவில்லை என்றால் ஆங்கிலப் பதிப்பே அடிப்படை.',
  },
  privacy: {
    title: 'தனியுரிமைக் கோரிக்கைகள்', intro: 'உங்கள் குழந்தையின் தரவைக் காட்ட, திருத்த அல்லது நீக்கப் பள்ளியிடம் கேட்கலாம், அல்லது புகார் அளிக்கலாம்.',
    kind: { access: 'என் குழந்தையின் தரவைக் காட்டவும்', correction: 'ஒன்றைத் திருத்தவும்', erasure: 'என் குழந்தையின் தரவை நீக்கவும்',
      consent_withdrawal: 'ஒப்புதலைத் திரும்பப் பெறவும்', grievance: 'புகார் அளிக்கவும்' },
    details: 'விவரங்கள் (விருப்பத்தேர்வு)', send: 'கோரிக்கையை அனுப்பவும்', sent: 'கோரிக்கை அனுப்பப்பட்டது. பள்ளி {{date}}-க்குள் பதிலளிக்கும்.',
    status: { open: 'திறந்துள்ளது', in_progress: 'நடைபெறுகிறது', completed: 'முடிந்தது', rejected: 'மூடப்பட்டது' },
    none: 'இதுவரை கோரிக்கைகள் இல்லை.', child: 'யாரைப் பற்றி', allChildren: 'என் எல்லாக் குழந்தைகளும்', type: 'கோரிக்கை',
  },
}

export const RESOURCES = { en: { translation: en }, hi: { translation: hi }, kn: { translation: kn }, ta: { translation: ta } }
