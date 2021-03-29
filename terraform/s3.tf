resource "aws_s3_bucket" "s3_in" {
  bucket = "in-${random_string.random.result}"
}

resource "aws_s3_bucket" "s3_out" {
  bucket = "out-${random_string.random.result}"
}

output "in" {
  value = aws_s3_bucket.s3_in.id
}

output "out" {
  value = aws_s3_bucket.s3_out.id
}
