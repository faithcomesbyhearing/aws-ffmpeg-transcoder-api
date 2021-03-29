resource aws_apigatewayv2_api apigateway {
  name          = "transcoding"
  protocol_type = "HTTP"
}

resource aws_apigatewayv2_stage apigateway {
  api_id      = aws_apigatewayv2_api.apigateway.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.apigateway.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      ip                      = "$context.identity.sourceIp"
      caller                  = "$context.identity.caller"
      user                    = "$context.identity.user"
      requestTime             = "$context.requestTime"
      httpMethod              = "$context.httpMethod"
      status                  = "$context.status"
      protocol                = "$context.protocol"
      responseLength          = "$context.responseLength"
      integrationErrorMessage = "$context.integrationErrorMessage"
    })
  }
}

resource aws_cloudwatch_log_group apigateway { name = "/aws/apigateway/${aws_apigatewayv2_api.apigateway.id}" }

resource aws_apigatewayv2_route apigateway_post_job {
  api_id    = aws_apigatewayv2_api.apigateway.id
  route_key = "POST /job"
  target    = "integrations/${aws_apigatewayv2_integration.apigateway_create_job.id}"
}

resource aws_apigatewayv2_route apigateway_get_job {
  api_id    = aws_apigatewayv2_api.apigateway.id
  route_key = "GET /job/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.apigateway_get_job.id}"
}

resource aws_apigatewayv2_integration apigateway_create_job {
  api_id                 = aws_apigatewayv2_api.apigateway.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.lambda["create-job"].invoke_arn
  payload_format_version = "2.0"
  credentials_arn        = aws_iam_role.apigateway.arn
}

resource aws_apigatewayv2_integration apigateway_get_job {
  api_id                 = aws_apigatewayv2_api.apigateway.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.lambda["get-job"].invoke_arn
  payload_format_version = "2.0"
  credentials_arn        = aws_iam_role.apigateway.arn
}

resource aws_iam_role apigateway { assume_role_policy = data.aws_iam_policy_document.apigateway_assume.json }

data aws_iam_policy_document apigateway_assume {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

resource aws_iam_role_policy_attachment apigateway {
  role       = aws_iam_role.apigateway.name
  policy_arn = aws_iam_policy.apigateway.arn
}

resource aws_iam_policy apigateway { policy = data.aws_iam_policy_document.apigateway.json }

data aws_iam_policy_document apigateway {
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      "${module.lambda["create-job"].arn}:*",
      "${module.lambda["get-job"].arn}:*",
    ]
  }
}

output url {
  value = aws_apigatewayv2_stage.apigateway.invoke_url
}
