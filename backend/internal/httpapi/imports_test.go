package httpapi

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestParseDecimalMinor(t *testing.T) {
	tests := map[string]int64{
		"1,234.56": 123456,
		"₹ 10.5":   1050,
		"(25.00)":  -2500,
		"-7.25":    -725,
		"-0.25":    -25,
	}
	for input, expected := range tests {
		actual, err := parseDecimalMinor(input)
		if err != nil {
			t.Fatalf("parseDecimalMinor(%q): %v", input, err)
		}
		if actual != expected {
			t.Fatalf("parseDecimalMinor(%q)=%d want %d", input, actual, expected)
		}
	}
}

func TestParseCSVRowRejectsMalformedFinancialValues(t *testing.T) {
	t.Parallel()
	mapping := csvMapping{
		DateColumn: "Date", DebitColumn: "Debit", CreditColumn: "Credit",
		DescriptionColumn: "Description", BalanceColumn: "Balance", DateFormat: "2006-01-02",
	}
	columns := map[string]int{"Date": 0, "Description": 1, "Debit": 2, "Credit": 3, "Balance": 4}
	for name, row := range map[string][]string{
		"debit":   {"2026-08-23", "test", "not-money", "", "1.00"},
		"credit":  {"2026-08-23", "test", "", "not-money", "1.00"},
		"balance": {"2026-08-23", "test", "1.00", "", "not-money"},
	} {
		row := row
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, _, _, err := parseCSVRow(row, columns, mapping); err == nil {
				t.Fatal("malformed financial value should be rejected")
			}
		})
	}
}

func TestParseCSVRowLeavesBlankBalanceAbsent(t *testing.T) {
	t.Parallel()
	mapping := csvMapping{
		DateColumn: "Date", DebitColumn: "Debit", CreditColumn: "Credit",
		DescriptionColumn: "Description", BalanceColumn: "Balance", DateFormat: "2006-01-02",
	}
	columns := map[string]int{"Date": 0, "Description": 1, "Debit": 2, "Credit": 3, "Balance": 4}
	_, amount, balance, err := parseCSVRow([]string{"2026-08-23", "test", "0.25", "", ""}, columns, mapping)
	if err != nil {
		t.Fatal(err)
	}
	if amount != -25 || balance != nil {
		t.Fatalf("amount=%d balance=%v, want -25 and no balance", amount, balance)
	}
}

func TestParseDecimalMinorRejectsOverflow(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"92233720368547758.99", "(92233720368547758.99)"} {
		if _, err := parseDecimalMinor(value); err == nil {
			t.Fatalf("parseDecimalMinor(%q) should reject overflow", value)
		}
	}
	conditions, err := json.Marshal(map[string]int64{"minimumAmount": 1})
	if err != nil {
		t.Fatal(err)
	}
	if matchesRule(conditions, "edge", math.MinInt64) {
		t.Fatal("matchesRule should not overflow when taking the absolute value")
	}
}

func TestImportFingerprintNormalizesDescription(t *testing.T) {
	date := mustDate(t, "2026-08-22")
	left := importFingerprint("account", date, "  UPI   Swiggy ", "ref", -100)
	right := importFingerprint("account", date, "upi swiggy", "REF", -100)
	if left != right {
		t.Fatal("normalized descriptions should produce the same fingerprint")
	}
}

func mustDate(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
