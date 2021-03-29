resource aws_sns_topic errors {
  name = "transcoding-api-errors-${random_string.random.result}"
}

resource aws_sns_topic_subscription errors {
  topic_arn = aws_sns_topic.errors.arn
  protocol  = "email"
  endpoint  = "ghopper@keyholesoftware.com"
}
