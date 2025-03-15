"""Decide whether a video title actually names a given song.

Corroborating the film or the singer is not enough on its own, and assuming
otherwise is what puts the wrong recording behind the right name. "Ab Ke Sajan
Sawan Mein" is from the film *Chupke Chupke*, so an upload of the entirely
different song "Chupke Chupke Chal Re Purbaiya" corroborates on film and scores
as a near-certain match. The song's own name has to appear too.

Three things make that harder than a substring test, none of them errors:

  Script.  Half these uploads title themselves in Devanagari. आधी रोटी सारा
  कबाब is "Aadhi Roti Sara Kabab" and must compare equal to it.

  Romanisation.  There is no agreed spelling. Meharban and Meherbaan, Aashiqui
  and आशिकी (which transliterates with a k), Nain and Nayan. The disagreements
  are overwhelmingly about vowel length and a handful of consonants, so those
  distinctions are folded out of both sides before comparing.

  Truncation.  A video title routinely keeps only the opening words of a long
  song name. "Aaj Unse Pehli Mulaqat" is a correct title for "Aaj Unse Pehli
  Mulaqat Hogi", so a solid prefix counts as present.

Comparison is word by word rather than over a flattened string. Folding is
lossy by design — it has to be, to make two spellings meet — and on a short
title it can leave very little: "Aa Aa Bhi Ja" reduces to "abhija", six
characters that duly turned up inside "Mer-a Bhi Ja-gjit" and replaced a
correct match with a Jagjit Singh ghazal. Words keep the boundaries that make
a short name mean something.
"""

import difflib
import re

# Rough Devanagari to Latin. Not a transliteration standard — it only has to be
# consistent enough that two spellings of one word land in the same place.
DEVANAGARI = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
    'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
    'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
    'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
    'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ॐ': 'om',
    'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
    'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
    'ं': 'n', 'ँ': 'n', 'ः': 'h', 'ृ': 'ri', '्': '', '़': '',
}

# Where two romanisations of the same sound disagree.
FOLD = (
    ('aa', 'a'), ('ee', 'i'), ('oo', 'u'), ('ii', 'i'), ('uu', 'u'),
    ('q', 'k'), ('w', 'v'), ('y', 'i'), ('z', 'j'), ('ph', 'f'),
)

WORD_RATIO = 0.75
# Comparing a whole run at once, spacing removed; needs to be tighter than the
# per-word ratio because there is more text for coincidence to hide in.
JOINED_RATIO = 0.86
# A song named in one or two words gives so little to match on that a prefix of
# it is meaningless; those must match in full.
MIN_PREFIX_WORDS = 3
SPLIT = re.compile(r'[^0-9A-Za-zऀ-ॿ]+')


def fold(text):
    """Comparison key: script-independent and romanisation-independent."""
    folded = ''.join(DEVANAGARI.get(ch, ch) for ch in (text or '')).lower()
    folded = re.sub(r'[^a-z0-9]', '', folded)
    for pattern, replacement in FOLD:
        folded = folded.replace(pattern, replacement)
    # Doubled letters survive both scripts inconsistently.
    return re.sub(r'(.)\1+', r'\1', folded)


def tokens(text):
    """Folded words, in order. Empty folds (stray punctuation) are dropped."""
    return [f for f in (fold(word) for word in SPLIT.split(text or '')) if f]


def _skeleton(word):
    return re.sub(r'[aeiou]', '', word)


def _same_word(want, got):
    if want == got:
        return True

    # Devanagari does not write the inherent vowel, so हद transliterates to
    # "hd" against a romanised "had", and में to "men" against "mein". The
    # consonants are what survive both scripts intact; two or more of them
    # agreeing is a real match, one is a coincidence waiting to happen.
    skeletons = (_skeleton(want), _skeleton(got))
    if skeletons[0] == skeletons[1] and len(skeletons[0]) >= 2:
        return True

    # Short words are mostly vowels once folded; a fuzzy ratio over two or
    # three characters says almost nothing, so they must match exactly.
    if min(len(want), len(got)) <= 3:
        return False
    return difflib.SequenceMatcher(None, want, got).ratio() >= WORD_RATIO


def _run_at(probe, hay, start):
    """Match probe against hay[start:], allowing the two to word-break apart.

    Where a name is divided is not information. "Aap Ke Haseen Rukh Pe" and
    "Aapke Haseen Rukh Pe" are the same title, as are "Jan E Man" and "Janeman",
    so a word-for-word comparison rejects correct matches. Joining both sides
    and comparing the run is indifferent to internal spacing — while still
    starting and ending on a word boundary, which is the part that matters: it
    is what stops "abhija" from being found inside "Mer-a Bhi Ja-gjit".
    """
    if all(_same_word(probe[i], hay[start + i]) for i in range(len(probe))
           if start + i < len(hay)) and start + len(probe) <= len(hay):
        return True

    want = ''.join(probe)
    joined = ''
    for index in range(start, len(hay)):
        joined += hay[index]
        if len(joined) > len(want) + 2:
            return False
        if joined == want:
            return True
        if len(joined) >= len(want) - 2 and \
                difflib.SequenceMatcher(None, want, joined).ratio() >= JOINED_RATIO:
            return True
    return False


def _probes(song_tokens):
    """The full name, then a leading part of it for truncated video titles."""
    yield song_tokens
    if len(song_tokens) > MIN_PREFIX_WORDS:
        cut = max(MIN_PREFIX_WORDS, int(len(song_tokens) * 0.65))
        if cut < len(song_tokens):
            yield song_tokens[:cut]


def names_song(song_title, video_title):
    """True when the video title names this song anywhere in it."""
    want, hay = tokens(song_title), tokens(video_title)
    if not want or not hay:
        return False
    for probe in _probes(want):
        # Every start, not just those with room for one video word per song
        # word: a joined title spends fewer words on the same name.
        for start in range(len(hay)):
            if _run_at(probe, hay, start):
                return True
    return False


def opens_with_song(song_title, video_title):
    """True when the video title *begins* with the song's name.

    Needed where merely containing the name proves nothing. A title song shares
    its name with its film, so every upload from that film carries it somewhere:
    "Din Jawani Ke Char Yaar - Pyar Kiye Jaa 1966" contains "Pyar Kiye Ja" and is
    a different song, while "Love In Tokyo - Mohammed Rafi" opens with it and is
    the right one.
    """
    want, hay = tokens(song_title), tokens(video_title)
    if not want or not hay:
        return False
    return any(_run_at(probe, hay, 0) for probe in _probes(want))
