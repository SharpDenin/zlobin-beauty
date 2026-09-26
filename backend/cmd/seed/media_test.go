package main

import "testing"

func TestEmailLocalPart(t *testing.T) {
	if got := emailLocalPart("Master1@demo.local"); got != "master1" {
		t.Fatalf("got %q", got)
	}
}

func TestSeedMediaSlug(t *testing.T) {
	if got := seedMediaSlug("Стрижка женская"); got != "стрижка-женская" {
		t.Fatalf("got %q", got)
	}
	if got := seedMediaSlug("  Dia Richesse  "); got != "dia-richesse" {
		t.Fatalf("got %q", got)
	}
}

func TestCoverFileForArticle(t *testing.T) {
	if got := coverFileForArticle("Уход", "Домашний уход после салона"); got != "articles/home.jpg" {
		t.Fatalf("home: %q", got)
	}
	if got := coverFileForArticle("Стайлинг", "Фиксация"); got != "articles/styling.jpg" {
		t.Fatalf("styling: %q", got)
	}
	if got := coverFileForArticle("Салон", "Санитарные нормы"); got != "articles/salon.jpg" {
		t.Fatalf("salon: %q", got)
	}
	if got := coverFileForArticle("Уход", "Протокол уходовых процедур"); got != "articles/care.jpg" {
		t.Fatalf("care: %q", got)
	}
	if got := coverFileForArticle("Колористика", "Majirel"); got != "articles/coloring.jpg" {
		t.Fatalf("coloring: %q", got)
	}
}

func TestApplyArticleCoversSkipsDraft(t *testing.T) {
	arts := []kbArt{
		{Title: "Домашний уход", Category: "Уход"},
		{Title: "Черновик", Category: "Колористика", Draft: true},
	}
	applyArticleCovers(arts)
	if arts[0].CoverFile != "articles/home.jpg" || !arts[0].WithCover {
		t.Fatalf("published: %+v", arts[0])
	}
	if arts[1].CoverFile != "" || arts[1].WithCover {
		t.Fatalf("draft should stay without cover: %+v", arts[1])
	}
}
