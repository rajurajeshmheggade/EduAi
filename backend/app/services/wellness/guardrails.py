import re
import logging
from typing import Dict, Any, Optional, List, Tuple

logger = logging.getLogger("eduai.wellness.guardrails")

# -------------------------------------------------------------
# Verified Groundtruth Knowledge Base
# -------------------------------------------------------------

GROUNDTRUTH_HELPLINES = {
    "tele_manas": {
        "name": "Tele-MANAS (Govt. of India)",
        "number": "14416 / 1800-891-4416",
        "description": "National Tele Mental Health Programme of India. 24x7, toll-free, multilingual tele-counseling.",
        "toll_free": True
    },
    "kiran": {
        "name": "KIRAN Mental Health Helpline",
        "number": "1800-599-0019",
        "description": "Ministry of Social Justice & Empowerment, Govt. of India. 24x7 toll-free crisis helpline.",
        "toll_free": True
    },
    "vandrevala": {
        "name": "Vandrevala Foundation for Mental Health",
        "number": "+91 9999 666 555",
        "description": "24x7 Free Psychological Counseling & Suicide Prevention Helpline & WhatsApp support.",
        "toll_free": False
    },
    "nimhans": {
        "name": "NIMHANS Psychosocial Support Helpline",
        "number": "080-46110007",
        "description": "Premier National Institute of Mental Health and Neuro-Sciences, Bengaluru.",
        "toll_free": False
    },
    "aasra": {
        "name": "AASRA Suicide Prevention Helpline",
        "number": "+91 98204 66726",
        "description": "24x7 Non-judgmental active listening and suicide prevention intervention.",
        "toll_free": False
    }
}

GROUNDTRUTH_STUDENT_COPING = [
    {
        "name": "Box Breathing (Sama Vritti)",
        "protocol": "4 seconds inhale, 4 seconds hold, 4 seconds exhale, 4 seconds hold.",
        "scientific_basis": "Triggers the parasympathetic vagal brake, reducing heart rate and cortisol within 90 seconds."
    },
    {
        "name": "4-7-8 Relaxing Breath",
        "protocol": "4 seconds nasal inhale, 7 seconds breath hold, 8 seconds slow pursed-lip exhale.",
        "scientific_basis": "Natural tranquilizer for the nervous system, ideal before bedtime or during pre-exam panic."
    },
    {
        "name": "5-4-3-2-1 Somatic Grounding",
        "protocol": "Name 5 things you see, 4 you can touch, 3 you can hear, 2 you can smell, 1 positive thought.",
        "scientific_basis": "Interrupts catastrophic amygdala hijacking by reactivating the prefrontal cortex."
    },
    {
        "name": "Pomodoro Focus Chunking",
        "protocol": "25 minutes of single-task study followed by a strict 5-minute screen-free break.",
        "scientific_basis": "Prevents cognitive depletion and sustains working memory performance."
    }
]

# -------------------------------------------------------------
# Deterministic Pre-Execution Guardrails
# -------------------------------------------------------------

# Crisis / Self-Harm Regex Patterns
CRISIS_PATTERNS = [
    r"\b(suicide|suicidal)\b",
    r"\bkill\s+(myself|me)\b",
    r"\bend\s+(my\s+life|it\s+all)\b",
    r"\bwant\s+to\s+die\b",
    r"\bwish\s+i\s+was\s+dead\b",
    r"\bno\s+reason\s+to\s+live\b",
    r"\bbetter\s+off\s+dead\b",
    r"\bhang\s+myself\b",
    r"\bslit\s+(my\s+)?(wrists?|throat)\b",
    r"\boverdose\b",
    r"\bjump\s+(off|from)\b",
    r"\bself\s*harm\b",
    r"\bcut\s+myself\b",
    r"\bgoodbye\s+cruel\s+world\b",
    r"\bdon'?t\s+want\s+to\s+wake\s+up\b"
]

# Medical & Prescription Substance Patterns
MEDICAL_SUBSTANCE_PATTERNS = [
    r"\b(adderall|modafinil|armodafinil|ritalin|methylphenidate|concerta)\b",
    r"\b(sleeping\s+pills?|sedatives?|xanax|alprazolam|valium)\b",
    r"\b(study\s+drugs?|smart\s+drugs?|pills\s+to\s+stay\s+awake)\b",
    r"\bwhat\s+(medication|medicine|drugs?)\s+(can|should)\s+i\s+take\b",
    r"\bprescribe\s+me\b"
]

# Academic Catastrophizing Patterns
CATASTROPHIZING_PATTERNS = [
    r"\b(my\s+life\s+is\s+(ruined|over|destroyed))\b",
    r"\bi\s+am\s+a\s+(complete\s+|total\s+)?(failure|loser|disgrace)\b",
    r"\bi\s+disappointed\s+everyone\b",
    r"\bi\s+have\s+no\s+future\b",
    r"\bif\s+i\s+don'?t\s+crack\s+.*\s+i\s+am\s+nothing\b",
    r"\beveryone\s+will\s+hate\s+me\b"
]

# Jailbreak / Prompt Injection Patterns
JAILBREAK_PATTERNS = [
    r"\bignore\s+(all\s+)?(previous\s+)?instructions\b",
    r"\bact\s+as\s+an?\s+unrestricted\b",
    r"\bbypass\s+(all\s+)?safety\b",
    r"\bdo\s+anything\s+now\b"
]


def check_crisis_guardrail(text: str) -> Optional[Dict[str, Any]]:
    """Tier 1: Immediate life-safety crisis intervention."""
    text_lower = text.lower()
    for pattern in CRISIS_PATTERNS:
        if re.search(pattern, text_lower):
            logger.warning(f"Tier 1 Crisis Guardrail Triggered by match: {pattern}")
            response_text = (
                "I hear how much pain you are experiencing right now, and I want you to know that you are not alone. "
                "Your life and well-being are infinitely more valuable than any exam, score, or academic outcome.\n\n"
                "Please connect with trained professionals right away who want to support you. Help is completely confidential and free:\n\n"
                "• Tele-MANAS (Govt. of India 24x7 Toll-Free): 14416 or 1800-891-4416\n"
                "• KIRAN Mental Health Helpline (24x7 Toll-Free): 1800-599-0019\n"
                "• Vandrevala Foundation (24x7 Helpline & WhatsApp): +91 9999 666 555\n"
                "• AASRA (24x7 Suicide Prevention): +91 98204 66726\n\n"
                "Please reach out to one of these numbers right now, or speak to a parent, teacher, or trusted adult."
            )
            return {
                "triggered": True,
                "guardrail_type": "crisis_self_harm",
                "severity": "CRITICAL",
                "response": response_text,
                "helplines": GROUNDTRUTH_HELPLINES
            }
    return None


def check_medical_guardrail(text: str) -> Optional[Dict[str, Any]]:
    """Tier 2: Medical and pharmaceutical stimulant advice boundary."""
    text_lower = text.lower()
    for pattern in MEDICAL_SUBSTANCE_PATTERNS:
        if re.search(pattern, text_lower):
            logger.info(f"Tier 2 Medical Guardrail Triggered by match: {pattern}")
            response_text = (
                "As your digital wellness companion, I must remind you that I cannot prescribe, recommend, or evaluate pharmaceutical substances or study stimulants. "
                "Prescription stimulants (like Modafinil or Adderall) carry serious cardiovascular and psychiatric risks and should NEVER be taken without a licensed medical doctor's diagnosis.\n\n"
                "For sustained study focus, proven neuro-protective habits include:\n"
                "• 20-minute power naps between study blocks to consolidate memory.\n"
                "• Electrolyte hydration and balanced complex carbohydrates.\n"
                "• 25-minute Pomodoro study intervals with active recall."
            )
            return {
                "triggered": True,
                "guardrail_type": "medical_substance",
                "severity": "HIGH",
                "response": response_text
            }
    return None


def check_catastrophizing_guardrail(text: str, exams_label: str = "your school tests and exams") -> Optional[Dict[str, Any]]:
    """Tier 3: Academic cognitive reframing intervention."""
    text_lower = text.lower()
    for pattern in CATASTROPHIZING_PATTERNS:
        if re.search(pattern, text_lower):
            logger.info(f"Tier 3 Catastrophizing Guardrail Triggered by match: {pattern}")
            response_text = (
                f"Preparing for {exams_label} puts real pressure on students, and your feelings are completely understandable. "
                "However, your mind is experiencing a cognitive distortion called 'Catastrophizing'—believing that an exam determines your entire future and human worth.\n\n"
                "The truth is: any test or exam checks preparation on specific syllabus questions, NOT your intelligence, capability, or value as a human being. "
                "Countless successful individuals found fulfilling careers through alternate pathways. Let us take a step back: take three slow, grounding breaths right now."
            )
            return {
                "triggered": True,
                "guardrail_type": "academic_catastrophizing",
                "severity": "MEDIUM",
                "response": response_text
            }
    return None


def check_jailbreak_guardrail(text: str) -> Optional[Dict[str, Any]]:
    """Tier 4: Prompt injection and jailbreak protection."""
    text_lower = text.lower()
    for pattern in JAILBREAK_PATTERNS:
        if re.search(pattern, text_lower):
            logger.warning(f"Tier 4 Jailbreak Guardrail Triggered by match: {pattern}")
            return {
                "triggered": True,
                "guardrail_type": "jailbreak_attempt",
                "severity": "LOW",
                "response": "I am Aura, dedicated solely to your student mental wellness and study support. How can I help you manage your study stress today?"
            }
    return None


def evaluate_input_guardrails(message: str, exams_label: str = "your school tests and exams") -> Optional[Dict[str, Any]]:
    """
    Run all deterministic guardrails in prioritized order:
    1. Crisis & Self-Harm (Tier 1)
    2. Medical Substances (Tier 2)
    3. Jailbreak & Toxicity (Tier 4)
    4. Academic Catastrophizing (Tier 3)
    """
    # 1. Life Safety Check
    crisis = check_crisis_guardrail(message)
    if crisis:
        return crisis

    # 2. Medical Check
    medical = check_medical_guardrail(message)
    if medical:
        return medical

    # 3. Jailbreak Check
    jailbreak = check_jailbreak_guardrail(message)
    if jailbreak:
        return jailbreak

    # 4. Catastrophizing Check
    catastrophe = check_catastrophizing_guardrail(message, exams_label)
    if catastrophe:
        return catastrophe

    return None


# -------------------------------------------------------------
# Memory Extraction Engine
# -------------------------------------------------------------

def extract_student_memories(user_message: str, grade_label: str = "school") -> List[Dict[str, str]]:
    """
    Automatically identify and extract key long-term facts from the student's conversation.
    Returns a list of dictionaries with category and memory_text.
    """
    memories = []
    msg_lower = user_message.lower()

    # 1. Subject/Topic Specific Struggles
    subjects_keywords = [
        "physics", "chemistry", "organic chemistry", "physical chemistry", "inorganic",
        "mathematics", "calculus", "algebra", "geometry", "biology", "genetics",
        "polity", "history", "geography", "economics", "civics", "social science", "english", "grammar", "hindi",
        "computer science", "trigonometry", "statistics", "electricity",
        "algorithms", "data structures", "thermodynamics", "electromagnetism"
    ]
    for subj in subjects_keywords:
        if subj in msg_lower and any(w in msg_lower for w in ["struggle", "weak", "tough", "hard", "backlog", "failing", "cannot understand", "trouble"]):
            memories.append({
                "category": "academic_struggle",
                "text": f"Has difficulty / backlog in {subj.title()}"
            })
            break

    # 2. Test Anxiety & Score Reactions
    if any(k in msg_lower for k in ["mock test", "mock score", "test marks", "scored low", "low marks", "unit test", "test score", "exam result", "report card"]):
        if any(w in msg_lower for w in ["sad", "low", "crying", "anxious", "depressed", "bad", "terrible", "dropped"]):
            memories.append({
                "category": "emotional_trigger",
                "text": f"Experiences high anxiety regarding test scores in {grade_label}"
            })

    # 3. Sleep & Fatigue Patterns
    if any(k in msg_lower for k in ["cannot sleep", "insomnia", "sleeping 3 hours", "sleeping 4 hours", "exhausted", "late night", "3 am", "4 am"]):
        memories.append({
            "category": "lifestyle_pattern",
            "text": "Struggles with irregular late-night sleep schedule during tests and exams"
        })

    # 4. Coping Preferences
    if any(k in msg_lower for k in ["breathing helped", "bubble helped", "music helped", "pomodoro worked", "grounding worked"]):
        memories.append({
            "category": "coping_preference",
            "text": "Responds positively to somatic breathing and grounding exercises"
        })

    return memories
