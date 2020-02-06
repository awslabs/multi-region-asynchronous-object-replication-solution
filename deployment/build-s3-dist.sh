#!/bin/bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./build-s3-dist.sh source-bucket-base-name solution-name version-code
#
# Paramenters:
#  - source-bucket-base-name: Name for the S3 bucket location where the template will source the Lambda
#    code from. The template will append '-[region_name]' to this bucket name.
#    For example: ./build-s3-dist.sh solutions my-solution v1.0.0
#    The template will then expect the source code to be located in the solutions-[region_name] bucket
#
#  - solution-name: name of the solution for consistency
#
#  - version-code: version of the package

# Check to see if input has been provided:
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Please provide the base source bucket name, trademark approved solution name and version where the lambda code will eventually reside."
    echo "For example: ./build-s3-dist.sh solutions trademarked-solution-name v1.0.0"
    exit 1
fi

# Get reference for all important folders
template_dir="$PWD"
template_dist_dir="$template_dir/global-s3-assets"
build_dist_dir="$template_dir/regional-s3-assets"
source_dir="$template_dir/../source"

echo "------------------------------------------------------------------------------"
echo "[Init] Clean old dist, node_modules and bower_components folders"
echo "------------------------------------------------------------------------------"
echo "rm -rf $template_dist_dir"
rm -rf $template_dist_dir
echo "mkdir -p $template_dist_dir"
mkdir -p $template_dist_dir
echo "rm -rf $build_dist_dir"
rm -rf $build_dist_dir
echo "mkdir -p $build_dist_dir"
mkdir -p $build_dist_dir

echo "------------------------------------------------------------------------------"
echo "[Packing] Templates"
echo "------------------------------------------------------------------------------"
echo "cp $template_dir/*.template $template_dist_dir/"
cp $template_dir/*.template $template_dist_dir/
echo "copy yaml templates and rename"
cp $template_dir/*.yaml $template_dist_dir/
cd $template_dist_dir
# Rename all *.yaml to *.template
for f in *.yaml; do 
    mv -- "$f" "${f%.yaml}.template"
done

cd ..
echo "Updating code source bucket in template with $1"
replace="s/%%BUCKET_NAME%%/$1/g"
echo "sed -i '' -e $replace $template_dist_dir/*.template"
sed -i '' -e $replace $template_dist_dir/*.template
replace="s/%%SOLUTION_NAME%%/$2/g"
echo "sed -i '' -e $replace $template_dist_dir/*.template"
sed -i '' -e $replace $template_dist_dir/*.template
replace="s/%%VERSION%%/$3/g"
echo "sed -i '' -e $replace $template_dist_dir/*.template"
sed -i '' -e $replace $template_dist_dir/*.template

echo "------------------------------------------------------------------------------"
echo "[Rebuild] Example Function"
echo "------------------------------------------------------------------------------"
#cd $source_dir/example-function-js
#npm run build
#cp ./dist/example-function-js.zip $build_dist_dir/example-function-js.zip



echo "Building create-mars-bucket function"
cd $source_dir/create-mars-bucket
npm install
npm run build
npm run zip
cp ./dist/create-mars-bucket.zip $build_dist_dir/create-mars-bucket.zip
# Remove temporary build files
rm -rf dist
rm -rf node_modules
rm package-lock.json

echo "Building custom-resource-global-table function"
cd $source_dir/custom-resource-global-table
npm install
npm run build
npm run zip
cp ./dist/custom-resource-global-table.zip $build_dist_dir/custom-resource-global-table.zip
# Remove temporary build files
rm -rf dist
rm -rf node_modules
rm package-lock.json

echo "Building custom-resource-parallel-stack function"
cd $source_dir/custom-resource-parallel-stack
npm install
npm run build
npm run zip
cp ./dist/custom-resource-parallel-stack.zip $build_dist_dir/custom-resource-parallel-stack.zip
# Remove temporary build files
rm -rf dist
rm -rf node_modules
rm package-lock.json


echo "Building delete-mars-bucket function"
cd $source_dir/delete-mars-bucket
npm install
npm run build
npm run zip
cp ./dist/delete-mars-bucket.zip $build_dist_dir/delete-mars-bucket.zip
# Remove temporary build files
rm -rf dist
rm -rf node_modules
rm package-lock.json


echo "Building queue-processor function"
cd $source_dir/queue-processor
npm install
npm run build
npm run zip
cp ./dist/queue-processor.zip $build_dist_dir/queue-processor.zip
# Remove temporary build files
rm -rf dist
rm -rf node_modules
rm package-lock.json


echo "Building stream-processor function"
cd $source_dir/stream-processor
npm install
npm run build
npm run zip
cp ./dist/stream-processor.zip $build_dist_dir/stream-processor.zip
# Remove temporary build files
rm -rf dist
rm -rf node_modules
rm package-lock.json




