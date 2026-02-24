variable "env" {
  description = "Environment name (dev, hml, prd)"
  type        = string
}

locals {
  config   = yamldecode(file("${path.module}/envs/${var.env}/config.yaml"))
  app_name = "${var.env}-${local.config.app_name}"
}

provider "aws" {
  region = local.config.aws_region
}

module "iam" {
  source   = "./modules/iam"
  app_name = local.app_name
}

module "ecr" {
  source   = "./modules/ecr"
  app_name = local.app_name
}

module "network" {
  source            = "./modules/network"
  app_name          = local.app_name
  vpc_id            = local.config.vpc_id
  public_subnet_ids = local.config.public_subnet_ids
  alb_port          = local.config.alb_port
  allow_cidr_lb     = local.config.allow_cidr_lb
  container_port    = local.config.container_port
  certificate_arn   = local.config.certificate_arn
}

module "ecs" {
  source             = "./modules/ecs"
  app_name           = local.app_name
  aws_region         = local.config.aws_region
  vpc_id             = local.config.vpc_id
  private_subnet_ids = local.config.private_subnet_ids
  container_port     = local.config.container_port
  allow_cidr_ecs     = local.config.allow_cidr_ecs
  execution_role_arn = module.iam.ecs_task_execution_role_arn
  repository_url     = module.ecr.repository_url
  target_group_arn   = module.network.target_group_arn
  alb_listener_arn   = module.network.alb_listener_arn
  environment_variables = [
    for k, v in try(local.config.environment_variables, {}) != null ? local.config.environment_variables : {} : {
      name  = k
      value = tostring(v)
    }
  ]
}

output "ecr_url" {
  value = module.ecr.repository_url
}

output "alb_dns_name" {
  value = module.network.alb_dns_name
}
