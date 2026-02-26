variable "env" {
  description = "Environment name (dev, hml, prd)"
  type        = string
  default     = "dev"
}

locals {
  config   = yamldecode(file("${path.module}/envs/${var.env}/config.yaml"))
  app_name = "${var.env}-${local.config.app_name}"
}

provider "aws" {
  region = local.config.aws_region

  default_tags {
    tags = {
      Environment  = "${var.env}"
      OwnerTeam     = "infra-cloud"
      ManagedBy = "Terraform"
      Application = "log-analyzer"
    }
  }
}

terraform {
  # defined in folder: envs/<env>/backend.tf
  # run command: terraform init -backend-config=envs/dev/backend.tf
  backend "s3" {} 
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  required_version = ">= 1.4.0"
}
