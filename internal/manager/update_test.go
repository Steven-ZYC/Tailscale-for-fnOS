package manager

import "testing"

func TestComparePackageVersions(t *testing.T) {
	tests := []struct {
		left  string
		right string
		want  int
		ok    bool
	}{
		{"1.102.2-fnos.0.1", "1.102.2-fnos.0.1", 0, true},
		{"1.102.2-fnos.0.1", "1.102.2-fnos.0.2", -1, true},
		{"1.102.2-fnos.0.9", "1.102.2-fnos.1", -1, true},
		{"1.102.2-fnos.1", "1.104.0-fnos.0.1", -1, true},
		{"1.104.0-fnos.1", "1.102.2-fnos.9", 1, true},
		{"dev", "1.102.2-fnos.0.1", 0, false},
	}
	for _, test := range tests {
		got, ok := comparePackageVersions(test.left, test.right)
		if got != test.want || ok != test.ok {
			t.Errorf("comparePackageVersions(%q, %q)=(%d,%v), want (%d,%v)", test.left, test.right, got, ok, test.want, test.ok)
		}
	}
}

func TestSafeLoginURL(t *testing.T) {
	valid := "https://login.tailscale.com/a/abc123"
	if got := safeLoginURL(valid); got != valid {
		t.Fatalf("valid URL rejected: %q", got)
	}
	for _, invalid := range []string{
		"http://login.tailscale.com/a/abc",
		"https://login.tailscale.com.evil.example/a/abc",
		"https://example.com/",
	} {
		if got := safeLoginURL(invalid); got != "" {
			t.Errorf("unsafe URL accepted: %q", got)
		}
	}
}
