// Forgiving search for kitchen and dish names.
//
// People type food names many ways: "paneer", "panir", "पनीर", "પનીર". To match them:
//  1. Hindi/Marathi (Devanagari) and Gujarati letters are spelled out in English letters.
//  2. Spellings are simplified the same way on both sides (ee → i, aa → a, kh → k, w → v...).
//  3. For longer words, the consonants alone are compared too, so "biryani" finds "biriyani".
// Works in the browser (window.SearchText) and in Node for the tests.

(function (root) {
  // Devanagari letters → English letters. Gujarati has the same layout, 0x180 further on.
  const VOWELS = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऍ': 'e', 'ऑ': 'o' };
  const SIGNS = { 'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o' };
  const CONSONANTS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h'
  };
  const VIRAMA = '्';
  const NASAL = { 'ं': 'n', 'ँ': 'n', 'ः': 'h' };

  // Gujarati → the matching Devanagari letter (same position in its Unicode block)
  function toDevanagari(ch) {
    const c = ch.charCodeAt(0);
    return c >= 0x0A80 && c <= 0x0AFF ? String.fromCharCode(c - 0x180) : ch;
  }

  function transliterate(text) {
    const chars = [...String(text)].map(toDevanagari).filter(ch => ch !== '़'); // drop nukta dots
    let out = '';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (CONSONANTS[ch]) {
        out += CONSONANTS[ch];
        const next = chars[i + 1];
        if (SIGNS[next]) { out += SIGNS[next]; i++; } else if (next === VIRAMA) { i++; } else out += 'a';
      } else if (VOWELS[ch]) out += VOWELS[ch];
      else if (SIGNS[ch]) out += SIGNS[ch];
      else if (NASAL[ch]) out += NASAL[ch];
      else out += ch;
    }
    return out;
  }

  // Simplify spelling the same way for the query and for the text searched
  function normalise(text) {
    return transliterate(text)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/['’]/g, '') // "Nanak's" = "nanaks"
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/chh/g, 'ch').replace(/ph/g, 'f').replace(/sh/g, 's')
      .replace(/([kgtdbj])h/g, '$1')
      .replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k')
      .replace(/ee|ii|ie/g, 'i').replace(/oo|uu|ou/g, 'u').replace(/aa/g, 'a')
      .replace(/([a-z])\1+/g, '$1')
      .split(/\s+/).filter(Boolean)
      .map(w => (w.length > 3 ? w.replace(/a$/, '') : w)) // "masala" = "masal", like मसाला
      .join(' ');
  }

  // Consonants only (first letter kept): "biryani" → "bryn", "बिरयानी" → "bryn"
  function skeleton(word) {
    return word[0] + word.slice(1).replace(/[aeiou]/g, '');
  }

  // Does every word of the query appear in the text (exactly, or with a near spelling)?
  function matches(text, query) {
    const q = normalise(query);
    if (!q) return true;
    const hay = normalise(text);
    const hayWords = hay.split(' ');
    return q.split(' ').every(w => hay.includes(w) ||
      (skeleton(w).length >= 3 && hayWords.some(h => skeleton(h).startsWith(skeleton(w)))));
  }

  const api = { transliterate, normalise, matches };
  root.SearchText = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
