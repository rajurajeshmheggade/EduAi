"""Curated catalogue of DIKSHA Virtual Labs collections for Classes 6-12.

Source: https://diksha.gov.in/virtuallabs.html ("Virtual Labs eContent", NCERT with Amrita Vishwa Vidyapeetham and
C-DAC). The page lists one collection (lab manual / activity book) per class, medium and subject; the experiments
inside each collection are read live from DIKSHA's hierarchy API, so only these entry points are kept here.
Some Hindi collections appear under both mediums on the source page; they are listed the same way.
"""
from __future__ import annotations

from typing import TypedDict

SOURCE_PAGE = "https://diksha.gov.in/virtuallabs.html"
CLASSES = list(range(6, 13))
MEDIUMS = ["English", "Hindi"]


class Collection(TypedDict):
    collection_id: str
    class_number: int
    medium: str
    subject: str
    label: str           # as written on the source page (Hindi medium in Devanagari)


# (class, medium, subject, label as shown on DIKSHA, collection id)
_ROWS: list[tuple[int, str, str, str, str]] = [
    # Class 6
    (6, "Hindi", "Mathematics", "गणित", "do_3135905488656302081606"),
    (6, "Hindi", "Science", "विज्ञान", "do_3135905480695644161600"),
    (6, "Hindi", "Hindi", "हिन्दी", "do_31430186524778496015975"),
    (6, "English", "Mathematics", "Mathematics", "do_3135898415885271041284"),
    (6, "English", "Science", "Science", "do_3135905411962470401499"),
    (6, "English", "Social Science", "Social Science", "do_31427837783343923216292"),
    (6, "English", "Hindi", "Hindi", "do_31430186328475238415969"),
    (6, "English", "English", "English", "do_31441787665338368012023"),
    (6, "English", "Sanskrit", "Sanskrit", "do_314481554298888192118282"),
    # Class 7
    (7, "Hindi", "Mathematics", "गणित", "do_3135905505826816001637"),
    (7, "Hindi", "Science", "विज्ञान", "do_3135905496130600961636"),
    (7, "Hindi", "Hindi", "हिन्दी", "do_31430186683028275216370"),
    (7, "English", "Mathematics", "Mathematics", "do_3135905420916654081504"),
    (7, "English", "Science", "Science", "do_3135898447443312641324"),
    (7, "English", "English", "English", "do_3135891137598259201175"),
    (7, "English", "Hindi", "Hindi", "do_31430186609070080016365"),
    (7, "English", "Social Science", "Social Science", "do_314372634738442240116731"),
    (7, "English", "Sanskrit", "Sanskrit", "do_314481569509253120115954"),
    # Class 8
    (8, "Hindi", "Mathematics", "गणित", "do_3135905527836098561528"),
    (8, "Hindi", "Science", "विज्ञान", "do_3135905512840724481644"),
    (8, "Hindi", "Hindi", "हिन्दी", "do_3145014393420021761252"),
    (8, "English", "Mathematics", "Mathematics", "do_3135898502189793281340"),
    (8, "English", "Science", "Science", "do_3135898485953576961339"),
    (8, "English", "English", "English", "do_3135891148932136961180"),
    (8, "English", "Social Science", "Social Science", "do_3144177679449784321578"),
    (8, "English", "Sanskrit", "Sanskrit", "do_314481571482918912115965"),
    (8, "English", "Hindi", "Hindi", "do_3145014393420021761252"),
    # Class 9
    (9, "Hindi", "Mathematics", "गणित", "do_3135614282776903681427"),
    (9, "Hindi", "Science", "विज्ञान", "do_3135614374705643521944"),
    (9, "Hindi", "Hindi", "हिन्दी", "do_3145014415073198081253"),
    (9, "Hindi", "Sanskrit", "संस्कृत", "do_3145120829207920641216"),
    (9, "English", "Mathematics", "Mathematics", "do_3135614240984678401921"),
    (9, "English", "Science", "Science", "do_3135614369279098881943"),
    (9, "English", "English", "English", "do_3135891158603857921395"),
    (9, "English", "Social Science", "Social Science", "do_314372644665991168118488"),
    (9, "English", "Hindi", "Hindi", "do_3145014415073198081253"),
    (9, "English", "Sanskrit", "Sanskrit", "do_3145120829207920641216"),
    # Class 10
    (10, "Hindi", "Mathematics", "गणित", "do_3135614387248496641947"),
    (10, "Hindi", "Science", "विज्ञान", "do_3135614398981079041447"),
    (10, "English", "Mathematics", "Mathematics", "do_3135614381103185921442"),
    (10, "English", "Science", "Science", "do_3135614393797099521445"),
    (10, "English", "Social Science", "Social Science", "do_314416463087919104192"),
    # Class 11
    (11, "Hindi", "Mathematics", "गणित", "do_3135650674626560001325"),
    (11, "Hindi", "Physics", "भौतिक विज्ञान", "do_3135650666990551041312"),
    (11, "Hindi", "Chemistry", "रसायन विज्ञान", "do_3135650682217349121326"),
    (11, "English", "Mathematics", "Mathematics", "do_31356154672996352011124"),
    (11, "English", "Physics", "Physics", "do_3135615477169192961994"),
    (11, "English", "Chemistry", "Chemistry", "do_3135615460891770881992"),
    (11, "English", "Biology", "Biology", "do_31356154520482611211123"),
    (11, "English", "Computer Science", "Computer Science", "do_3135891166921113601400"),
    # Class 12
    (12, "Hindi", "Mathematics", "गणित", "do_3135650687467356161327"),
    (12, "Hindi", "Physics", "भौतिक विज्ञान", "do_31356155074559180811127"),
    (12, "Hindi", "Chemistry", "रसायन विज्ञान", "do_3135650692831232001329"),
    (12, "English", "Mathematics", "Mathematics", "do_3135615496660582401998"),
    (12, "English", "Physics", "Physics", "do_31356155014016204811000"),
    (12, "English", "Chemistry", "Chemistry", "do_3135615491556311041996"),
    (12, "English", "Biology", "Biology", "do_3135615483842068481995"),
    (12, "English", "Computer Science", "Computer Science", "do_31406623335698432016332"),
]

COLLECTIONS: list[Collection] = [
    {"collection_id": cid, "class_number": c, "medium": m, "subject": s, "label": lbl} for c, m, s, lbl, cid in _ROWS
]


def entries(collection_id: str) -> list[Collection]:
    """Catalogue rows of one collection (a Hindi collection can be listed under both mediums)."""
    return [c for c in COLLECTIONS if c["collection_id"] == collection_id]


def classes_of(collection_id: str) -> set[int]:
    return {c["class_number"] for c in entries(collection_id)}
