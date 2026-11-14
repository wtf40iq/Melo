import { describe, expect, it } from "vitest";
import { baseTitle, coverage, dedupeTracks, norm, rankTracks, switchLayout } from "./match";
import { Track } from "../types";

const track = (id: string, artist: string, title: string, duration = 180): Track => ({
  id, ownerId: 1, audioId: Number(id), artist, title, duration, url: "https://example.com/a.mp3",
});

describe("match", () => {
  it("normalizes text", () => {
    expect(norm("  Ёлка — Песня! ")).toBe("елка песня");
  });

  it("counts word coverage", () => {
    expect(coverage("hello world", "hello there world")).toBe(1);
    expect(coverage("hello world", "hello")).toBe(0.5);
  });

  it("strips noise from titles", () => {
    expect(baseTitle("Song (Explicit)")).toBe("Song");
    expect(baseTitle("Song [без цензуры]")).toBe("Song");
  });

  it("switches keyboard layout", () => {
    expect(switchLayout("ghbdtn")).toBe("привет");
  });

  it("ranks exact artist/title first", () => {
    const list = [track("1", "Other", "Song"), track("2", "Artist", "Song"), track("3", "Artist", "Other")];
    expect(rankTracks(list, { artist: "Artist", title: "Song" }, true)[0].id).toBe("2");
  });

  it("dedupes same song with same duration", () => {
    const list = [track("1", "A", "B"), track("2", "A", "B"), track("3", "A", "B", 200)];
    expect(dedupeTracks(list).map((x) => x.id)).toEqual(["1", "3"]);
  });
});
