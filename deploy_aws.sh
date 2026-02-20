#!/bin/bash

AWS_REGION="us-east-1"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO_NAME="csv-log-analyzer"
CLUSTER_NAME="log-analyzer-cluster"
SERVICE_NAME="log-analyzer-service"

echo "# Iniciando Pipeline de Deploy..."

echo "# Autenticando no Amazon ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

echo "# Construindo imagem Docker..."
docker build -t $ECR_REPO_NAME .

echo "# Tagging e enviando para o ECR..."
docker tag $ECR_REPO_NAME:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest

echo "# Aplicando mudanças na infraestrutura (Terraform)..."
cd terraform
terraform init
terraform apply -auto-approve
cd ..

echo "# Atualizando serviço no ECS para usar a nova imagem..."
aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment

echo "# Deploy finalizado com sucesso!"
