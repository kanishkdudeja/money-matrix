package ledger

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

func TestSumRejectsOverflow(t *testing.T) {
	t.Parallel()
	_, err := sumBucketEntries([]BucketEntryInput{{Amount: math.MaxInt64}, {Amount: 1}})
	if err == nil {
		t.Fatal("sum should reject int64 overflow")
	}
}

func TestBucketTransferRejectsCategoriesAndRequiresDistinctBuckets(t *testing.T) {
	t.Parallel()
	base := CreateCommand{
		OccurredOn: time.Now(), Description: "move allocation", Kind: "bucket_transfer", Origin: "manual",
		BucketEntries: []BucketEntryInput{{BucketID: "bucket-a", Amount: -100}, {BucketID: "bucket-a", Amount: 100}},
	}
	if _, err := CreateWithQueries(context.Background(), nil, base); !errors.Is(err, ErrInvalid) {
		t.Fatalf("same-target bucket transfer error = %v, want ErrInvalid", err)
	}
	base.BucketEntries[1].BucketID = "bucket-b"
	categoryID := "category"
	base.BucketEntries[0].CategoryID = &categoryID
	if _, err := CreateWithQueries(context.Background(), nil, base); !errors.Is(err, ErrInvalid) {
		t.Fatalf("categorized bucket transfer error = %v, want ErrInvalid", err)
	}
}

func TestReversalRejectsAmountThatCannotBeNegated(t *testing.T) {
	t.Parallel()
	_, err := reversalCommand(Transaction{
		Kind:     "expense",
		Postings: []Posting{{Amount: "-9223372036854775808"}},
	}, "reversal")
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("reversalCommand error = %v, want ErrInvalid", err)
	}
}
