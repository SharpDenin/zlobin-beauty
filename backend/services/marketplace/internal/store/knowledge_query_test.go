package store

import (
	"strings"
	"testing"
)

// A search for "50%" or "a_b" must look for that text, not act as a LIKE wildcard.
func TestKnowledgeWhereEscapesLikeWildcards(t *testing.T) {
	cases := map[string]string{
		"50%":     `%50\%%`,
		"a_b":     `%a\_b%`,
		`c:\dir`:  `%c:\\dir%`,
		"  Otium": `%Otium%`,
	}
	for q, wantLike := range cases {
		where, args, _ := knowledgeWhere(KnowledgeListFilter{Query: q})
		if !strings.Contains(where, "ka.title ILIKE") {
			t.Fatalf("%q: query filter missing: %s", q, where)
		}
		var found bool
		for _, a := range args {
			if s, ok := a.(string); ok && s == wantLike {
				found = true
			}
		}
		if !found {
			t.Fatalf("%q: want ILIKE argument %q in %#v", q, wantLike, args)
		}
	}
}

func TestKnowledgeWhereSkipsBlankQuery(t *testing.T) {
	where, args, _ := knowledgeWhere(KnowledgeListFilter{Query: "   "})
	if strings.Contains(where, "ILIKE") || len(args) != 0 {
		t.Fatalf("blank query must not add a filter: %s %#v", where, args)
	}
}
