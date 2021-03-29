resource aws_dynamodb_table dynamodb {
  name             = "transcoding-api-jobs-${random_string.random.result}"
  hash_key         = "id"
  billing_mode     = "PAY_PER_REQUEST"
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  attribute {
    name = "id"
    type = "S"
  }
}
