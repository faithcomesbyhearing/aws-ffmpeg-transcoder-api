variable environment { type = map(string) }
variable function_name { type = string }
variable layers { type = list(string) }
variable memory_size { type = number }
variable source_dir { type = string }
variable statements { type = list(map(any)) }
variable timeout { type = number }

resource aws_lambda_function lambda {
  function_name    = var.function_name
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs14.x"
  publish          = true
  role             = aws_iam_role.role.arn
  layers           = var.layers
  timeout          = var.timeout
  memory_size      = var.memory_size

  dynamic environment {
    for_each = length(var.environment) > 0 ? [null] : []
    content {
      variables = var.environment
    }
  }
}

data archive_file lambda {
  type        = "zip"
  output_path = ".terraform/${var.function_name}.zip"
  source_dir  = var.source_dir
  excludes = concat(
    [
      "Makefile",
      "package-lock.json",
      "package.json",
      "tsconfig.json",
    ],
    tolist(fileset("get_input_files", "*.ts"))
  )
}

resource aws_iam_role role {
  name               = "transcoding-api-${var.function_name}"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data aws_iam_policy_document assume {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::078432969830:user/ghopper"]
    }
  }
}

resource aws_iam_role_policy_attachment attachment {
  role       = aws_iam_role.role.name
  policy_arn = aws_iam_policy.policy.arn
}

resource aws_iam_policy policy { policy = data.aws_iam_policy_document.document.json }

data aws_iam_policy_document document {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["${aws_cloudwatch_log_group.group.arn}:*"]
  }

  dynamic statement {
    for_each = var.statements
    content {
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource aws_cloudwatch_log_group group { name = "/aws/lambda/${aws_lambda_function.lambda.function_name}" }

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

output arn { value = aws_lambda_function.lambda.arn }
output qualified_arn { value = aws_lambda_function.lambda.qualified_arn }
output function_name { value = aws_lambda_function.lambda.function_name }
# output invoke_arn { value = aws_lambda_function.lambda.invoke_arn }
output invoke_arn { value = "arn:${data.aws_partition.current.partition}:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.lambda.qualified_arn}/invocations" }
