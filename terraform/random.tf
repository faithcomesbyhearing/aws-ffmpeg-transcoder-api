resource "random_string" "random" {
  length  = 16
  special = false
  upper   = false
}

resource "random_password" "secret" {
  length = 16
}
