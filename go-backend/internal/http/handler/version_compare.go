package handler

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var preReleasePattern = regexp.MustCompile(`[.-](alpha|beta|rc|dev)[.-]?(\d*)$`)

type versionParts struct {
	numbers     []int
	stageRank   int
	stageNumber int
}

func parseVersionParts(version string) versionParts {
	normalized := strings.ToLower(strings.TrimSpace(version))
	normalized = strings.TrimPrefix(normalized, "v")

	stageRank := 0
	stageNumber := 0

	preReleaseMatch := preReleasePattern.FindStringSubmatch(normalized)
	baseVersion := normalized

	if preReleaseMatch != nil {
		stage := preReleaseMatch[1]
		switch stage {
		case "rc":
			stageRank = 3
		case "beta":
			stageRank = 2
		case "alpha":
			stageRank = 1
		}
		if preReleaseMatch[2] != "" {
			stageNumber, _ = strconv.Atoi(preReleaseMatch[2])
		}
		baseVersion = normalized[:strings.Index(normalized, preReleaseMatch[0])]
	} else if stableVersionPattern.MatchString(normalized) {
		stageRank = 4
	}

	re := regexp.MustCompile(`\d+`)
	matches := re.FindAllString(baseVersion, -1)
	numbers := make([]int, len(matches))
	for i, m := range matches {
		numbers[i], _ = strconv.Atoi(m)
	}

	return versionParts{
		numbers:     numbers,
		stageRank:   stageRank,
		stageNumber: stageNumber,
	}
}

// compareVersions returns negative if a < b, 0 if equal, positive if a > b.
func compareVersions(a, b string) int {
	aa := parseVersionParts(a)
	bb := parseVersionParts(b)

	maxLen := len(aa.numbers)
	if len(bb.numbers) > maxLen {
		maxLen = len(bb.numbers)
	}

	for i := 0; i < maxLen; i++ {
		aVal, bVal := 0, 0
		if i < len(aa.numbers) {
			aVal = aa.numbers[i]
		}
		if i < len(bb.numbers) {
			bVal = bb.numbers[i]
		}
		if aVal != bVal {
			return aVal - bVal
		}
	}

	if aa.stageRank != bb.stageRank {
		return aa.stageRank - bb.stageRank
	}

	return aa.stageNumber - bb.stageNumber
}

// sortVersionsDesc sorts versions in descending order (newest first) in-place.
func sortVersionsDesc(versions []string) {
	sort.Slice(versions, func(i, j int) bool {
		return compareVersions(versions[i], versions[j]) > 0
	})
}
