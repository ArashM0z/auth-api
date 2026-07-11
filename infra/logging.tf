# ---------------------------------------------------------------------------
# ALB access-log bucket. Private, versioned, lifecycle-expired after
# var.log_retention_days, and writable ONLY by the ELB log-delivery service.
#
# Encryption is deliberately SSE-S3 (AES256), not the project CMK: ALB log
# delivery cannot write to a bucket with KMS-CMK default encryption — this is
# an AWS limitation, not a choice.
# ---------------------------------------------------------------------------

# Regional ELB log-delivery account (ca-central-1 predates the
# logdelivery.elasticloadbalancing.amazonaws.com service principal, so the
# account-root grant is what actually matters there).
data "aws_elb_service_account" "main" {}

resource "aws_s3_bucket" "alb_logs" {
  #checkov:skip=CKV_AWS_145:ALB log delivery requires SSE-S3; it cannot write to a KMS-CMK-encrypted bucket.
  #checkov:skip=CKV_AWS_18:Access logging on the access-log bucket itself would recurse; this bucket only ever receives ALB logs.
  #checkov:skip=CKV2_AWS_62:No consumer for object-created events on a log-delivery bucket; notifications would be noise.
  #checkov:skip=CKV_AWS_144:Single-region demo; cross-region replication of ALB logs would double storage cost with no DR requirement.

  # Account ID in the name because S3 bucket names are GLOBALLY unique.
  bucket = "${local.name_prefix}-alb-logs-${data.aws_caller_identity.current.account_id}"

  # Demo convenience, mirroring ECR's force_delete: `tofu destroy` works even
  # with delivered logs present. Production keeps logs past the stack.
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  # SSE-S3, not the CMK — see the header comment (ALB log-delivery limitation).
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning guards against overwrite/tamper of delivered logs; expired
# noncurrent versions are cleaned up by the lifecycle rule below.
resource "aws_s3_bucket_versioning" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.log_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.log_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Only the ELB log-delivery service may write, and only under this bucket.
# Both principal forms are included: the regional ELB account (older regions,
# incl. ca-central-1) and the log-delivery service principal (newer regions).
data "aws_iam_policy_document" "alb_logs" {
  statement {
    sid       = "ALBLogDeliveryAccount"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_logs.arn}/*"]

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }
  }

  statement {
    sid       = "ALBLogDeliveryService"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_logs.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = data.aws_iam_policy_document.alb_logs.json
}
