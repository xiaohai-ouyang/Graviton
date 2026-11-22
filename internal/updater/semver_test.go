package updater

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCompareVersion_Ordering(t *testing.T) {
	ordered := []string{"0.1.0-rc.8", "0.1.0-rc.9", "0.1.0", "0.1.1-rc.1", "0.1.1", "0.2.0", "1.0.0"}
	for i := 0; i < len(ordered)-1; i++ {
		cmp, err := CompareVersion(ordered[i], ordered[i+1])
		require.NoError(t, err)
		assert.Equal(t, -1, cmp, "%s should be < %s", ordered[i], ordered[i+1])

		cmp, err = CompareVersion(ordered[i+1], ordered[i])
		require.NoError(t, err)
		assert.Equal(t, 1, cmp)
	}
	cmp, err := CompareVersion("0.1.0-rc.9", "0.1.0-rc.9")
	require.NoError(t, err)
	assert.Equal(t, 0, cmp)

	// Multi-digit RC numbers compare numerically, not lexically.
	cmp, err = CompareVersion("0.1.0-rc.10", "0.1.0-rc.9")
	require.NoError(t, err)
	assert.Equal(t, 1, cmp)
}

func TestCompareVersion_RejectsInvalid(t *testing.T) {
	for _, bad := range []string{"", "1.0", "v1.0.0", "1.0.0-rc.0", "1.0.0-beta.1", "abc"} {
		_, err := CompareVersion(bad, "1.0.0")
		assert.Error(t, err, "expected rejection for %q", bad)
	}
}

func TestIsReleaseEligible_ChannelFiltering(t *testing.T) {
	// stable channel: only stable, non-prerelease versions
	assert.True(t, IsReleaseEligible("stable", "0.2.0", false))
	assert.False(t, IsReleaseEligible("stable", "0.2.0-rc.1", false))
	assert.False(t, IsReleaseEligible("stable", "0.2.0", true))
	assert.False(t, IsReleaseEligible("stable", "not-a-version", false))

	// rc/dev channels: accept both rc and stable
	assert.True(t, IsReleaseEligible("rc", "0.2.0-rc.1", true))
	assert.True(t, IsReleaseEligible("rc", "0.2.0", false))
	assert.True(t, IsReleaseEligible("dev", "0.2.0-rc.1", true))
	assert.True(t, IsReleaseEligible("dev", "0.2.0", false))
	assert.False(t, IsReleaseEligible("rc", "garbage", false))
}