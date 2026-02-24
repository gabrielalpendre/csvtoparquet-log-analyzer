variable "app_name" {
  description = "Application name"
  type        = string
}

resource "aws_ecr_repository" "app" {
  name         = var.app_name
  force_delete = true

  tags = {
    Name = var.app_name
  }
}

output "repository_url" {
  value = aws_ecr_repository.app.repository_url
}
