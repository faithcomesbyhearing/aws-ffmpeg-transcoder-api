resource aws_lambda_layer_version ffmpeg {
  filename            = data.archive_file.ffmpeg.output_path
  source_code_hash    = data.archive_file.ffmpeg.output_base64sha256
  layer_name          = "ffmpeg-${random_string.random.result}"
  compatible_runtimes = ["nodejs14.x"]
}

data archive_file ffmpeg {
  type        = "zip"
  output_path = ".terraform/ffmpeg.zip"
  source_dir  = "ffmpeg-layer/layer"
}

resource aws_lambda_layer_version ffprobe {
  filename            = data.archive_file.ffprobe.output_path
  source_code_hash    = data.archive_file.ffprobe.output_base64sha256
  layer_name          = "ffprobe-${random_string.random.result}"
  compatible_runtimes = ["nodejs14.x"]
}

data archive_file ffprobe {
  type        = "zip"
  output_path = ".terraform/ffprobe.zip"
  source_dir  = "ffprobe-layer/layer"
}
