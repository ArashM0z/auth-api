# ---------------------------------------------------------------------------
# One customer-managed KMS key (CMK, ~USD 1/mo + per-request) shared by every
# encrypted resource in the stack: ECR images, CloudWatch log groups,
# ElastiCache at-rest, and both Secrets Manager secrets. One key keeps the
# demo cheap and auditable; a larger system would split keys per data class
# so access and rotation blast radius can differ.
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "cmk" {
  # The root-account anchor statement every key policy needs: without it the
  # key becomes unmanageable (even by admins) the moment the policy is the
  # only path to it. Resource "*" in a KEY policy means "this key" only.
  #checkov:skip=CKV_AWS_109:Root-account anchor statement required in every KMS key policy; "*" here means this key only.
  #checkov:skip=CKV_AWS_111:Same as above — kms:* for the account root is the AWS-documented key-policy anchor, not a general IAM grant.
  #checkov:skip=CKV_AWS_356:Resource "*" inside a KEY policy is scoped to the key itself, not all resources.
  statement {
    sid       = "RootAccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # CloudWatch Logs encrypts log groups with the key itself (not via an IAM
  # role), so the service principal needs explicit key-policy access, scoped
  # by encryption context to log groups in this account/region only.
  statement {
    sid = "CloudWatchLogsUse"
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_key" "main" {
  description         = "CMK for ${local.name_prefix}: ECR, CloudWatch Logs, ElastiCache, Secrets Manager"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.cmk.json

  # Demo: shortest allowed window so `tofu destroy` cleans up quickly.
  # Production keeps the 30-day default as an undo window.
  deletion_window_in_days = 7
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name_prefix}"
  target_key_id = aws_kms_key.main.key_id
}
