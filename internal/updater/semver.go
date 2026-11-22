package updater

import (
	"strconv"
	"strings"

	"graviton/internal/buildinfo"
)

type parsedVersion struct {
	major int
	minor int
	patch int
	rc    int // 0 means stable release
}

func parseSemver(v string) (parsedVersion, error) {
	numeric, channel, err := buildinfo.ParseVersion(v)
	if err != nil {
		return parsedVersion{}, err
	}
	parts := strings.Split(numeric, ".")
	major, _ := strconv.Atoi(parts[0])
	minor, _ := strconv.Atoi(parts[1])
	patch, _ := strconv.Atoi(parts[2])
	pv := parsedVersion{major: major, minor: minor, patch: patch}
	if channel == buildinfo.ChannelRC {
		rcStr := strings.TrimPrefix(strings.TrimSpace(v), numeric+"-rc.")
		pv.rc, _ = strconv.Atoi(rcStr)
	}
	return pv, nil
}

// CompareVersion compares two Graviton versions (X.Y.Z or X.Y.Z-rc.N).
// It returns -1 if a < b, 0 if equal, 1 if a > b. Stable outranks RC at the same numeric version.
func CompareVersion(a, b string) (int, error) {
	pa, err := parseSemver(a)
	if err != nil {
		return 0, err
	}
	pb, err := parseSemver(b)
	if err != nil {
		return 0, err
	}
	for _, pair := range [][2]int{{pa.major, pb.major}, {pa.minor, pb.minor}, {pa.patch, pb.patch}} {
		if pair[0] != pair[1] {
			if pair[0] < pair[1] {
				return -1, nil
			}
			return 1, nil
		}
	}
	// Same numeric version: stable (rc == 0) ranks above any RC; higher RC number wins.
	sa, sb := pa.rc, pb.rc
	if sa == 0 {
		sa = int(^uint(0) >> 1) // max int
	}
	if sb == 0 {
		sb = int(^uint(0) >> 1)
	}
	if sa != sb {
		if sa < sb {
			return -1, nil
		}
		return 1, nil
	}
	return 0, nil
}

// IsReleaseEligible reports whether a release version may be offered to the given channel.
// stable only accepts stable releases; rc/dev accept both stable and rc versions.
func IsReleaseEligible(currentChannel, version string, isPrerelease bool) bool {
	_, ch, err := buildinfo.ParseVersion(version)
	if err != nil {
		return false
	}
	if currentChannel == buildinfo.ChannelStable {
		return !isPrerelease && ch == buildinfo.ChannelStable
	}
	return true
}

// versionFromTagName strips the leading "v" from a release tag like "v0.1.0-rc.9".
func versionFromTagName(tag string) string {
	return strings.TrimPrefix(strings.TrimSpace(tag), "v")
}
