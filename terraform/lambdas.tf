variable in_bucket_arns { type = list(string) }
variable out_bucket_arns { type = list(string) }

locals {
  environment = {
    TABLE_NAME = aws_dynamodb_table.dynamodb.id
    # STATE_MACHINE_ARN = aws_sfn_state_machine.sfn.arn
    STATE_MACHINE_ARN = "arn:${data.aws_partition.current.partition}:states:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:stateMachine:transcode-${random_string.random.result}"
    SECRET            = random_password.secret.result
  }

  layers = {
    FFMPEG  = aws_lambda_layer_version.ffmpeg.arn
    FFPROBE = aws_lambda_layer_version.ffprobe.arn
  }

  statements = {
    SNS_PUBLISH = {
      actions   = ["sns:Publish"]
      resources = [aws_sns_topic.errors.arn]
    }
    DYNAMODB_WRITE = {
      actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
      resources = [aws_dynamodb_table.dynamodb.arn]
    }
    DYNAMODB_READ = {
      actions   = ["dynamodb:GetItem"]
      resources = [aws_dynamodb_table.dynamodb.arn]
    }
    DYNAMODB_STREAM = {
      actions = [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams",
      ]
      resources = [aws_dynamodb_table.dynamodb.stream_arn]
    }
    START_EXECUTION = {
      actions   = ["states:StartExecution"]
      resources = [aws_sfn_state_machine.sfn.arn]
    }
    LIST_IN_BUCKET = {
      actions   = ["s3:ListBucket"]
      resources = var.in_bucket_arns
    }
    GET_IN_BUCKET = {
      actions   = ["s3:GetObject"]
      resources = [for in_bucket_arn in var.in_bucket_arns : "${in_bucket_arn}/*"]
    }
    PUT_OUT_BUCKET = {
      actions   = ["s3:PutObject", "s3:PutObjectAcl"]
      resources = [for out_bucket_arn in var.out_bucket_arns : "${out_bucket_arn}/*"]
    }
  }
}

module lambda {
  source   = "./modules/lambda"
  for_each = toset([for file in fileset("lambdas", "*/index.js") : trimsuffix(file, "/index.js")])

  function_name = "transcoding-api-${each.key}-${random_string.random.result}"
  source_dir    = "lambdas/${each.key}"
  timeout       = lookup(jsondecode(file("lambdas/${each.key}/package.json")).lambda, "timeout", null)
  memory_size   = lookup(jsondecode(file("lambdas/${each.key}/package.json")).lambda, "memory_size", null)

  environment = merge({
    for k in lookup(jsondecode(file("lambdas/${each.key}/package.json")).lambda, "environment", [])
    : k => local.environment[k] if can(tostring(k))
    },
    [for k in lookup(jsondecode(file("lambdas/${each.key}/package.json")).lambda, "environment", [])
    : k if ! can(tostring(k))]...
  )

  layers = [
    for k in lookup(jsondecode(file("lambdas/${each.key}/package.json")).lambda, "layers", [])
    : local.layers[k]
  ]

  statements = [
    for k in lookup(jsondecode(file("lambdas/${each.key}/package.json")).lambda, "statements", [])
    : local.statements[k]
  ]
}

resource aws_lambda_event_source_mapping start_job {
  event_source_arn       = aws_dynamodb_table.dynamodb.stream_arn
  function_name          = module.lambda["start-job"].function_name
  starting_position      = "LATEST"
  batch_size             = 1
  maximum_retry_attempts = 0

  destination_config {
    on_failure {
      destination_arn = aws_sns_topic.errors.arn
    }
  }
}

resource aws_lambda_permission invoke_create_zip {
  action        = "lambda:InvokeFunction"
  function_name = module.lambda["create-zip"].function_name
  principal     = "869054869504"
}
