resource aws_sfn_state_machine sfn {
  name     = "transcode-${random_string.random.result}"
  role_arn = aws_iam_role.sfn.arn
  definition = jsonencode({
    StartAt = "GetInputFiles"
    States = {
      GetInputFiles = {
        Type       = "Task"
        Resource   = module.lambda["get-input-files"].qualified_arn
        ResultPath = "$.chunks"
        Next       = "MapChunks"
      }
      MapChunks = {
        Type       = "Map"
        ItemsPath  = "$.chunks"
        ResultPath = "$.chunks"
        Next       = "Success"
        Iterator = {
          StartAt = "TranscodeChunk"
          States = {
            TranscodeChunk = {
              Type     = "Task"
              Resource = "arn:aws:states:::states:startExecution.sync:2"
              End      = true
              Parameters = {
                Input = {
                  "files.$"                                      = "$"
                  "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$" = "$$.Execution.Id"
                }
                StateMachineArn = aws_sfn_state_machine.sfn_chunk.arn
              }
            }
          }
        }
      }
      Success = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Parameters = {
          TableName                 = aws_dynamodb_table.dynamodb.id
          Key                       = { id = { "S.$" = "$.id" } }
          UpdateExpression          = "SET #status = :success"
          ConditionExpression       = "#status = :pending"
          ExpressionAttributeNames  = { "#status" = "status" }
          ExpressionAttributeValues = { ":success" = "SUCCESS", ":pending" = "PENDING" }
        }
        Retry = [{
          ErrorEquals = ["States.ALL"]
          MaxAttempts = 8
        }]
        End = true
      }
    }
  })
}

resource aws_sfn_state_machine sfn_chunk {
  name     = "transcode-chunk-${random_string.random.result}"
  role_arn = aws_iam_role.sfn.arn
  definition = jsonencode({
    StartAt = "MapFiles"
    States = {
      MapFiles = {
        Type      = "Map"
        ItemsPath = "$.files"
        End       = true
        Iterator = {
          StartAt = "Transcode"
          States = {
            Transcode = {
              Type     = "Task"
              Resource = module.lambda["transcode"].qualified_arn
              Catch = [{
                ErrorEquals = ["States.ALL"]
                ResultPath  = "$.error"
                Next        = "Failure"
              }]
              End = true
            }
            Failure = {
              Type     = "Task"
              Resource = "arn:aws:states:::dynamodb:updateItem"
              Parameters = {
                TableName            = aws_dynamodb_table.dynamodb.id
                Key                  = { id = { "S.$" = "$.id" } }
                "UpdateExpression.$" = "States.Format('SET #status = :failed, #remaining = #remaining - :one, #errors = list_append(if_not_exists(#errors, :empty), :errors), #files[{}].#error = :error, #files[{}].#status = :failed', $.index, $.index)"
                ExpressionAttributeNames = {
                  "#error"     = "error"
                  "#errors"    = "errors"
                  "#files"     = "files"
                  "#remaining" = "remaining"
                  "#status"    = "status"
                }
                ExpressionAttributeValues = {
                  ":empty"  = { "L" : [] }
                  ":error"  = { "S.$" : "$.error.Cause" }
                  ":errors" = { "L" : [{ "S.$" : "$.error.Cause" }] }
                  ":failed" = { "S" : "FAILED" }
                  ":one"    = { "N" : "1" }
                }
              }
              Retry = [{
                ErrorEquals = ["States.ALL"]
                MaxAttempts = 8
              }]
              End = true
            }
          }
        }
      }
    }
  })
}

resource aws_iam_role sfn { assume_role_policy = data.aws_iam_policy_document.sfn_assume.json }

data aws_iam_policy_document sfn_assume {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource aws_iam_role_policy_attachment sfn {
  role       = aws_iam_role.sfn.name
  policy_arn = aws_iam_policy.sfn.arn
}

resource aws_iam_policy sfn { policy = data.aws_iam_policy_document.sfn.json }

data aws_iam_policy_document sfn {
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      "${module.lambda["get-input-files"].arn}:*",
      "${module.lambda["transcode"].arn}:*"
    ]
  }

  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.dynamodb.arn]
  }

  statement {
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.sfn_chunk.arn]
  }

  statement {
    actions = [
      "events:PutTargets",
      "events:PutRule",
      "events:DescribeRule"
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:events:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule"
    ]
  }
}
