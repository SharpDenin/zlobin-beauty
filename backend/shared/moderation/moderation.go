// Package moderation is the single, server-side text policy for user generated content.
//
// It deliberately stays small: normalization + word-family matching. It is not an AI
// classifier. Backend validation is the source of truth; the frontend only renders the
// `content_not_allowed` error returned by the API.
//
// Policy (see docs/MODERATION.md):
//   - profanity (Russian/English families, including common obfuscation)
//   - direct insults
//   - slurs
//   - operator extended list via MODERATION_EXTRA_WORDS (comma separated exact words)
package moderation

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"

	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

// Result is the outcome of checking one text.
type Result struct {
	Allowed bool
	// Matches holds normalized offending words (never echoed to the client verbatim).
	Matches []string
}

var latinToCyrillic = map[rune]rune{
	'a': 'а', 'b': 'в', 'c': 'с', 'e': 'е', 'h': 'н', 'k': 'к', 'm': 'м',
	'o': 'о', 'p': 'р', 't': 'т', 'x': 'х', 'y': 'у',
}

// profanity and insult families, matched against whole normalized words (ё is folded to е).
var cyrillicPatterns = []*regexp.Regexp{
	// хуй family
	regexp.MustCompile(`^(?:за|на|по|пере|под|при|раз|рас|с|у|вы|до|от|об|не|ни|а|о|ох|пох|нах)?ху(?:й|я|е|и|ев|ям|ями|ях|ю|ем|йня|ёвый|евый|ила|ило)\p{L}*$`),
	regexp.MustCompile(`^(?:по|на|вы|до|от|за|пере|при|раз|с|у|об|под|про|съ)?хуи\p{L}*$`),
	// пизд family
	regexp.MustCompile(`^\p{L}*пизд\p{L}*$`),
	// еб family (strict forms to avoid "ребенок", "требуется" etc.)
	regexp.MustCompile(`^(?:за|вы|до|на|об|от|по|под|пере|при|раз|рас|с|у|про|съ|разъ|отъ|не|а)?еб(?:ать|ан|ана|аный|анный|анутый|ал|ала|али|ало|ашить|ашу|ись|и|ись|ите|ит|ут|ёт|ет|ёшь|ешь|ла|лан|ло|ля|лю|ну|нул|нулся|нутый|ырь|ун|уч\p{L}*)$`),
	regexp.MustCompile(`^(?:за|вы|до|на|об|от|по|под|пере|при|раз|рас|с|у|про)?еб(?:ал\p{L}*|ан\p{L}*|аш\p{L}*)$`),
	regexp.MustCompile(`^(?:ёб|еб)(?:тв\p{L}*|н\p{L}*)$`),
	regexp.MustCompile(`^долбо?еб\p{L}*$`),
	regexp.MustCompile(`^долбаеб\p{L}*$`),
	// бля family
	regexp.MustCompile(`^бл(?:я|ят|ять|ядь|ядс\p{L}*|ядин\p{L}*|ядст\p{L}*)$`),
	regexp.MustCompile(`^(?:сука|суки|суку|сукой|сучка|сучки|сучара|сучий)$`),
	// мудак family
	regexp.MustCompile(`^муда(?:к|ки|ков|ка|ку|ком|ки|чь\p{L}*)$`),
	regexp.MustCompile(`^мудил\p{L}*$`),
	regexp.MustCompile(`^мудозвон\p{L}*$`),
	// пидор family (anchored: does not match "скипидар")
	regexp.MustCompile(`^пид(?:о|а|е)р\p{L}*$`),
	regexp.MustCompile(`^пидрил\p{L}*$`),
	regexp.MustCompile(`^г(?:а|о)ндон\p{L}*$`),
	regexp.MustCompile(`^залуп\p{L}*$`),
	regexp.MustCompile(`^шлюх\p{L}*$`),
	regexp.MustCompile(`^ублюд\p{L}*$`),
	regexp.MustCompile(`^говн\p{L}*$`),
	regexp.MustCompile(`^дерьм\p{L}*$`),
	regexp.MustCompile(`^срать$|^сру$|^срал\p{L}*$|^высер\p{L}*$|^засер\p{L}*$`),
	regexp.MustCompile(`^манд(?:а|ы|у|ой|овошк\p{L}*)$`),
	// direct insults
	// ("тупой", "козел", "отстой" are intentionally absent: "тупой срез" is a haircut term.)
	regexp.MustCompile(`^(?:идиот|идиоты|идиотка|идиотский|дебил|дебилы|дебилка|дебильный|кретин|кретины|кретинка|придурок|придурки|придурочный|тупица|урод|уроды|уродом|уроду|уродина|уродка|тварь|твари|мразь|мрази|мразота|сволочь|сволочи|скотина|скоты|чмо|чмошник|падла|падлы|гнида|гниды|выродок|выродки|ничтожество|лох|лохи|лошара|сволота)$`),
	// slurs
	regexp.MustCompile(`^(?:чурка|чурки|чурок|хач|хачи|хачей|жид|жиды|жидов|пиндос\p{L}*|даун|дауны|дауны|чернож\p{L}*|хохлы|кацап\p{L}*)$`),
}

var latinPatterns = []*regexp.Regexp{
	regexp.MustCompile(`^(?:fuck\p{L}*|f[uv]ck\p{L}*|shit\p{L}*|bitch\p{L}*|cunt\p{L}*|asshole\p{L}*|motherfuck\p{L}*|whore\p{L}*|slut\p{L}*|bastard|dickhead|dick|dicks|cock|pussy|nigg(?:a|er)\p{L}*|faggot\p{L}*|retard\p{L}*)$`),
}

var (
	extraOnce  sync.Once
	extraWords map[string]struct{}
)

func loadExtra() {
	extraWords = map[string]struct{}{}
	for _, raw := range strings.Split(os.Getenv("MODERATION_EXTRA_WORDS"), ",") {
		w := strings.TrimSpace(raw)
		if w == "" {
			continue
		}
		extraWords[normalizeWord(w)] = struct{}{}
	}
}

func isZeroWidth(r rune) bool {
	switch r {
	case '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad':
		return true
	}
	return false
}

func normalizeWord(w string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(w) {
		if isZeroWidth(r) {
			continue
		}
		if r == 'ё' {
			r = 'е'
		}
		b.WriteRune(r)
	}
	return b.String()
}

func mapLookalikes(word string) string {
	hasCyr := false
	for _, r := range word {
		if r >= 'а' && r <= 'я' {
			hasCyr = true
			break
		}
	}
	// A pure Latin word is matched with Latin patterns as-is; mixed-script words are
	// transliterated to Cyrillic so "xуй" / "пизд@" style tricks collapse to one script.
	if !hasCyr {
		return word
	}
	var b strings.Builder
	for _, r := range word {
		if m, ok := latinToCyrillic[r]; ok {
			b.WriteRune(m)
			continue
		}
		if r == '0' {
			b.WriteRune('о')
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func collapseRepeats(word string) string {
	var b strings.Builder
	var prev rune
	for _, r := range word {
		if r == prev {
			continue
		}
		b.WriteRune(r)
		prev = r
	}
	return b.String()
}

func tokenize(text string) []string {
	var words []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			words = append(words, cur.String())
			cur.Reset()
		}
	}
	for _, r := range normalizeWord(text) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			cur.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	// Glue runs of single letters ("п и з д е ц") into one word.
	out := make([]string, 0, len(words))
	for i := 0; i < len(words); {
		j := i
		for j < len(words) && len([]rune(words[j])) == 1 {
			j++
		}
		if j-i >= 3 {
			out = append(out, strings.Join(words[i:j], ""))
			i = j
			continue
		}
		out = append(out, words[i])
		i++
	}
	return out
}

func matchWord(word string) bool {
	word = mapLookalikes(word)
	variants := []string{word}
	if collapsed := collapseRepeats(word); collapsed != word {
		variants = append(variants, collapsed)
	}
	extraOnce.Do(loadExtra)
	for _, v := range variants {
		if _, ok := extraWords[v]; ok {
			return true
		}
		for _, re := range cyrillicPatterns {
			if re.MatchString(v) {
				return true
			}
		}
		for _, re := range latinPatterns {
			if re.MatchString(v) {
				return true
			}
		}
	}
	return false
}

// Check evaluates one text against the policy.
func Check(text string) Result {
	text = strings.TrimSpace(text)
	if text == "" {
		return Result{Allowed: true}
	}
	var matches []string
	seen := map[string]struct{}{}
	for _, w := range tokenize(text) {
		if matchWord(w) {
			if _, dup := seen[w]; !dup {
				seen[w] = struct{}{}
				matches = append(matches, w)
			}
		}
	}
	return Result{Allowed: len(matches) == 0, Matches: matches}
}

// ValidateText returns a typed validation error when text violates the policy.
func ValidateText(field, text string) error {
	if Check(text).Allowed {
		return nil
	}
	return apperr.ContentNotAllowed(field)
}

// ValidateFields checks several fields and reports every offending field key in details.fields.
// Keys are the JSON field names the client submitted (name, description, comment, ...).
func ValidateFields(fields map[string]string) error {
	var bad []string
	for key, text := range fields {
		if !Check(text).Allowed {
			bad = append(bad, key)
		}
	}
	if len(bad) == 0 {
		return nil
	}
	sort.Strings(bad)
	return apperr.ContentNotAllowed(bad...)
}
