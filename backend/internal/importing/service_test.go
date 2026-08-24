package importing

import (
	"math"
	"testing"
)

func TestPostingAmountForCoverage(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		amount       int64
		balanceClass string
		want         int64
		wantErr      bool
	}{
		{name: "asset income", amount: 1000, balanceClass: "asset", want: 1000},
		{name: "asset expense", amount: -1000, balanceClass: "asset", want: -1000},
		{name: "liability purchase", amount: -1000, balanceClass: "liability", want: 1000},
		{name: "liability refund", amount: 1000, balanceClass: "liability", want: -1000},
		{name: "liability minimum integer", amount: math.MinInt64, balanceClass: "liability", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := postingAmountForCoverage(tt.amount, tt.balanceClass)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("postingAmountForCoverage() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("postingAmountForCoverage() = %d, want %d", got, tt.want)
			}
		})
	}
}
