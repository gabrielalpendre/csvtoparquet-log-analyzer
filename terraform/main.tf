locals {
  config = yamldecode(file("${path.module}/config.yaml"))
}

provider "aws" {
  region = local.config.aws_region
}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${local.config.app_name}-cluster"

  tags = {
    Name = "${local.config.app_name}-cluster"
  }
}

# ECR Repository
resource "aws_ecr_repository" "app" {
  name         = local.config.app_name
  force_delete = true

  tags = {
    Name = local.config.app_name
  }
}

# Task Definition
resource "aws_ecs_task_definition" "app" {
  family                   = "${local.config.app_name}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([
    {
      name      = local.config.app_name
      image     = "${aws_ecr_repository.app.repository_url}:tfcreation"
      essential = true
      portMappings = [
        {
          containerPort = local.config.container_port
          hostPort      = local.config.container_port
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${local.config.app_name}"
          "awslogs-region"        = local.config.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = {
    Name = "${local.config.app_name}-task"
  }
}

# CloudWatch Logs
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.config.app_name}"
  retention_in_days = 1
}

# IAM Role for ECS
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${local.config.app_name}-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Security Group for ALB
resource "aws_security_group" "alb_sg" {
  name   = "${local.config.app_name}-alb-sg"
  vpc_id = local.config.vpc_id

  ingress {
    from_port   = local.config.alb_port
    to_port     = local.config.alb_port
    protocol    = "tcp"
    cidr_blocks = local.config.allow_cidr_lb
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.config.app_name}-alb-sg"
  }
}

# Security Group for ECS Tasks
resource "aws_security_group" "ecs_sg" {
  name   = "${local.config.app_name}-ecs-tasks-sg"
  vpc_id = local.config.vpc_id

  ingress {
    from_port   = local.config.container_port
    to_port     = local.config.container_port
    protocol    = "tcp"
    cidr_blocks = local.config.allow_cidr_ecs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.config.app_name}-ecs-tasks-sg"
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${local.config.app_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = local.config.public_subnet_ids

  tags = {
    Name = "${local.config.app_name}-alb"
  }
}

# ALB Target Group
resource "aws_lb_target_group" "app" {
  name        = "${local.config.app_name}-tg"
  port        = local.config.container_port
  protocol    = "HTTP"
  vpc_id      = local.config.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 3
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = {
    Name = "${local.config.app_name}-tg"
  }
}

# ALB Listener
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = local.config.alb_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# ECS Service
resource "aws_ecs_service" "main" {
  name            = "${local.config.app_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 0
  launch_type     = "FARGATE"

  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = local.config.app_name
    container_port   = local.config.container_port
  }

  network_configuration {
    subnets          = local.config.private_subnet_ids
    security_groups  = [aws_security_group.ecs_sg.id]
    assign_public_ip = false
  }

  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${local.config.app_name}-service"
  }
}

output "ecr_url" {
  value = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}
